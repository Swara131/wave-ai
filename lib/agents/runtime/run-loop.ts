import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateToolThroughControlLayer } from "./control/control-layer";
import { RuntimeActivityLogger } from "./activity/activity-logger";
import {
  AgentRuntimeLimitError,
  AgentRuntimeTimeoutError,
} from "./errors";
import { requestModelTurn } from "./model/provider";
import {
  isFailureCompleteMessage,
  isPromptEcho,
  taskNeedsWebResearch,
  toolStepLabel,
} from "./model/task-intent";
import { taskNeedsRecordLookup } from "./data/resolve-query-source";
import { formatQueryToolReport } from "./analysis/structured-report";
import type { RecordAnalysisResult } from "./analysis/record-validation";
import { analyzeRetrievedRecords } from "./analysis/record-validation";
import { resolveActionType } from "./tools/definitions";
import { assertToolEnabledForAgent } from "./tools/registry";
import { executeAuthorizedTool } from "@/lib/safety/passport/execute-authorized";
import { resolveAgentMission } from "@/lib/safety/mission";
import { bindApprovalPassport } from "@/lib/safety/approval-gate/gate";
import { getActionProposalById } from "@/lib/gateway/proposals/repository";
import { effectiveReviewDeadline } from "@/lib/gateway/review/timeout";
import type { PendingRuntimeApproval } from "../protection/types";
import type {
  LoadedAgent,
  ModelMessage,
  RunAgentResult,
  RuntimeLimits,
} from "./types";
import type { RunAgentParams } from "./types";
import { updateAgentRun } from "../runtime-repository";

function parseToolPayload(content: string): {
  executed: boolean;
  output: Record<string, unknown>;
  error?: string | null;
} | null {
  try {
    const parsed = JSON.parse(content) as {
      executed?: boolean;
      output?: Record<string, unknown>;
      error?: string | null;
    };
    if (!parsed || typeof parsed !== "object") return null;
    return {
      executed: Boolean(parsed.executed),
      output: parsed.output ?? {},
      error: parsed.error ?? null,
    };
  } catch {
    return null;
  }
}

function lastQueryToolResult(messages: ModelMessage[]): {
  toolName: string;
  executed: boolean;
  output: Record<string, unknown>;
  error?: string | null;
} | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "tool") continue;
    const payload = parseToolPayload(message.content);
    if (!payload) continue;
    const previous = messages[index - 1];
    let toolName = "";
    if (previous?.role === "assistant") {
      try {
        const parsed = JSON.parse(previous.content) as { toolName?: string };
        toolName = typeof parsed.toolName === "string" ? parsed.toolName : "";
      } catch {
        toolName = "";
      }
    }
    if (
      payload.executed &&
      (toolName === "query_supabase" || toolName === "query_database" || toolName === "google_sheets")
    ) {
      return { toolName, ...payload };
    }
  }
  return null;
}

function toolResultMessage(outcome: {
  executed: boolean;
  output: Record<string, unknown>;
  error?: string;
}): string {
  return JSON.stringify({
    executed: outcome.executed,
    output: outcome.output,
    error: outcome.error ?? null,
  });
}

function mapControlDecision(
  decision: "ALLOW" | "REVIEW" | "BLOCK"
): "allow" | "review" | "block" {
  return decision.toLowerCase() as "allow" | "review" | "block";
}

function mapActionStatus(
  decision: "ALLOW" | "REVIEW" | "BLOCK"
): "allowed" | "review_required" | "blocked" {
  if (decision === "ALLOW") return "allowed";
  if (decision === "BLOCK") return "blocked";
  return "review_required";
}

export interface AgentRunLoopState {
  messages: ModelMessage[];
  toolCalls: number;
  turns: number;
  actionSequence: number;
  proposalId: string | null;
}

export interface AgentRunLoopParams {
  admin: SupabaseClient;
  agent: LoadedAgent;
  userId: string;
  task: string;
  runId: string | null;
  limits: RuntimeLimits;
  activity: RuntimeActivityLogger;
  runMode?: RunAgentParams["mode"];
  initialState?: Partial<AgentRunLoopState>;
}

function isIntegrationConfigError(message: string | undefined): boolean {
  if (!message) return false;
  return /not configured|connect|api key|TAVILY|BRAVE_SEARCH|RESEND|GROQ|GROK/i.test(message);
}

function integrationSettingsPath(toolName: string): string {
  switch (toolName) {
    case "web_search":
      return "/settings?tab=integrations&provider=web_search";
    default:
      return "/settings?tab=integrations";
  }
}

function toolFailureMessage(toolName: string, error?: string): string {
  if (toolName === "web_search" && isIntegrationConfigError(error)) {
    return "Web Search is not connected. Add a search API key in Settings.";
  }
  return error ?? "Tool execution failed.";
}

async function failRunOnToolError(params: {
  activity: RuntimeActivityLogger;
  runId: string | null;
  toolName: string;
  error?: string;
  proposalId: string | null;
  toolCalls: number;
  turns: number;
  analysis?: RecordAnalysisResult;
}): Promise<RunAgentResult> {
  const friendly = toolFailureMessage(params.toolName, params.error);
  const analysis =
    params.analysis ??
    (params.toolName === "query_supabase" || params.toolName === "query_database"
      ? analyzeRetrievedRecords({
          table: "agent_crm_updates",
          rows: [],
          agent: {
            name: "agent",
            goal: "",
            description: "",
            instructions: null,
            safetySettings: {},
          },
          error: friendly,
          tableAvailable: false,
        })
      : undefined);

  await params.activity.logRunStep({
    runId: params.runId,
    key: `tool.${params.toolName}.failed`,
    label: toolStepLabel(params.toolName, "failed").label,
    detail: friendly,
    status: "failed",
  });

  await params.activity.finishRun({
    runId: params.runId,
    status: "failed",
    summary: null,
    errorMessage: friendly,
    metadata: {
      integrationTool: params.toolName,
      settingsPath: integrationSettingsPath(params.toolName),
    },
  });

  return {
    runId: params.runId,
    status: "failed",
    summary: null,
    error: friendly,
    proposalId: params.proposalId,
    toolCalls: params.toolCalls,
    turns: params.turns,
    steps: params.activity.getSteps(),
    analysis,
    protection: {
      summary: friendly,
      details: {
        integrationTool: params.toolName,
        settingsPath: integrationSettingsPath(params.toolName),
      },
    },
  };
}

export async function runAgentLoop(
  params: AgentRunLoopParams
): Promise<RunAgentResult> {
  const messages: ModelMessage[] = [...(params.initialState?.messages ?? [])];
  let toolCalls = params.initialState?.toolCalls ?? 0;
  let turns = params.initialState?.turns ?? 0;
  let actionSequence = params.initialState?.actionSequence ?? 0;
  let proposalId = params.initialState?.proposalId ?? null;

  const deadline = Date.now() + params.limits.maxDurationMs;

  try {
    while (turns < params.limits.maxTurns) {
      if (Date.now() > deadline) {
        throw new AgentRuntimeTimeoutError(params.limits.maxDurationMs);
      }

      turns += 1;

      const thinkingLabel =
        turns === 1
          ? "Understanding task"
          : toolCalls > 0
            ? "Creating summary"
            : "Planning next step";

      await params.activity.logRunStep({
        runId: params.runId,
        key: `model.turn.${turns}`,
        label: thinkingLabel,
        detail: params.task.slice(0, 160),
      });

      const turn = await requestModelTurn({
        agent: params.agent,
        task: params.task,
        messages,
        enabledToolNames: params.agent.enabledTools,
      });

      if (turn.type === "complete") {
        if (
          taskNeedsRecordLookup(params.task, params.agent) &&
          toolCalls === 0 &&
          params.agent.enabledTools.includes("query_supabase")
        ) {
          messages.push({
            role: "user",
            content:
              "You must call query_supabase first to fetch real records. Do not return the prompt or saved configuration.",
          });
          continue;
        }

        if (isPromptEcho(turn.message, params.task) && !lastQueryToolResult(messages)) {
          messages.push({
            role: "assistant",
            content: JSON.stringify({ type: "complete", rejected: true, message: turn.message }),
          });
          messages.push({
            role: "user",
            content:
              "Do not repeat the task. Use your enabled tools to gather real data, then return the actual deliverable.",
          });
          continue;
        }

        if (
          taskNeedsWebResearch(params.task, params.agent) &&
          toolCalls === 0 &&
          params.agent.enabledTools.includes("web_search")
        ) {
          messages.push({
            role: "user",
            content:
              "You must call web_search first to gather live results before completing this research task.",
          });
          continue;
        }

        const queryResult = lastQueryToolResult(messages);
        let finalMessage = turn.message;
        let analysis: RecordAnalysisResult | undefined;
        if (queryResult) {
          const formatted = formatQueryToolReport({
            toolOutput: queryResult.output,
            agent: params.agent.record,
            task: params.task,
            toolError: queryResult.error,
          });
          finalMessage = formatted.text;
          analysis = formatted.analysis;
        }

        if (isFailureCompleteMessage(turn.message) && !queryResult) {
          await params.activity.finishRun({
            runId: params.runId,
            status: "failed",
            summary: null,
            errorMessage: turn.message,
          });

          return {
            runId: params.runId,
            status: "failed",
            summary: null,
            error: turn.message,
            proposalId,
            toolCalls,
            turns,
            steps: params.activity.getSteps(),
          };
        }

        await params.activity.logRunStep({
          runId: params.runId,
          key: "run.finished",
          label: "Run finished",
          detail: analysis
            ? analysis.empty
              ? "Database is empty; 0 records analyzed"
              : analysis.unavailable
                ? "Database unavailable"
                : `Analyzed ${analysis.analyzedCount} record(s)`
            : "Task execution complete",
        });

        await params.activity.finishRun({
          runId: params.runId,
          status: "completed",
          summary: finalMessage,
          metadata: analysis ? { analysis } : undefined,
        });

        return {
          runId: params.runId,
          status: "completed",
          summary: finalMessage,
          error: null,
          proposalId: null,
          toolCalls,
          turns,
          steps: params.activity.getSteps(),
          analysis,
        };
      }

      assertToolEnabledForAgent(params.agent.enabledTools, turn.toolName);

      if (toolCalls >= params.limits.maxToolCalls) {
        throw new AgentRuntimeLimitError(
          `Agent reached the maximum of ${params.limits.maxToolCalls} tool calls.`
        );
      }

      actionSequence += 1;
      const actionType = resolveActionType(turn.toolName, turn.actionType);

      const toolLabel = toolStepLabel(turn.toolName, "before");
      await params.activity.logRunStep({
        runId: params.runId,
        key: `tool.${turn.toolName}.start`,
        label: toolLabel.label,
        detail:
          typeof turn.toolInput.query === "string"
            ? turn.toolInput.query
            : toolLabel.detail ?? turn.toolName,
      });

      await params.activity.logRunStep({
        runId: params.runId,
        key: `control.${turn.toolName}`,
        label: "Wave Protection check",
        detail: turn.toolName,
      });

      const control = await evaluateToolThroughControlLayer(params.admin, {
        agent: params.agent,
        userId: params.userId,
        organizationId: params.agent.record.organizationId,
        toolName: turn.toolName,
        toolInput: turn.toolInput,
        actionType,
        runId: params.runId,
        source: "agent_runtime",
      });

      proposalId = control.proposalId;

      const agentActionId = await params.activity.recordAction({
        runId: params.runId,
        sequence: actionSequence,
        toolName: turn.toolName,
        actionType,
        summary: control.plainEnglishSummary ?? control.reason,
        status: mapActionStatus(control.decision),
        proposalId: control.proposalId,
        policyDecision: mapControlDecision(control.decision),
      });

      if (control.decision === "REVIEW") {
        const missionGoal = resolveAgentMission(params.agent).goal ?? null;
        const proposal = await getActionProposalById(params.admin, {
          proposalId: control.proposalId!,
          organizationId: params.agent.record.organizationId,
        });
        const approvalExpiresAt = proposal
          ? effectiveReviewDeadline(proposal)
          : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        const passport = await bindApprovalPassport({
          admin: params.admin,
          organizationId: params.agent.record.organizationId,
          builderAgentId: params.agent.record.id,
          gatewayAgentId: params.agent.gatewayAgentId,
          agentRunId: params.runId,
          agentActionId,
          proposalId: control.proposalId!,
          tool: turn.toolName,
          action: actionType,
          parameters: turn.toolInput,
          missionGoal,
          expiresAt: approvalExpiresAt,
        });

        const pendingApproval: PendingRuntimeApproval = {
          proposalId: control.proposalId!,
          passportId: passport.passportId,
          toolName: turn.toolName,
          toolInput: turn.toolInput,
          actionType,
          agentActionId,
          turns,
          toolCalls,
          actionSequence,
          messages: messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          protectionReason: control.why ?? control.reason,
          riskLevel:
            (control.riskLevel as PendingRuntimeApproval["riskLevel"]) ?? "medium",
        };

        await params.activity.finishRun({
          runId: params.runId,
          status: "awaiting_approval",
          summary: control.plainEnglishSummary ?? "Waiting for your approval before continuing.",
          errorMessage: control.why ?? control.reason,
          metadata: {
            task: params.task,
            pendingApproval,
          },
        });

        return {
          runId: params.runId,
          status: "awaiting_approval",
          summary:
            control.plainEnglishSummary ??
            "Your agent needs your approval before this action can continue.",
          error: control.why ?? control.reason,
          proposalId: control.proposalId,
          toolCalls,
          turns,
          steps: params.activity.getSteps(),
          protection: {
            summary: control.plainEnglishSummary ?? control.reason,
            why: control.why ?? control.reason,
            riskLevel: control.riskLevel,
          },
        };
      }

      if (control.decision === "BLOCK") {
        messages.push({
          role: "assistant",
          content: JSON.stringify({
            type: "tool_call",
            toolName: turn.toolName,
            blocked: true,
            reason: control.reason,
          }),
        });
        messages.push({
          role: "tool",
          content: toolResultMessage({
            executed: false,
            output: { blocked: true, matchedPolicies: control.matchedPolicies },
            error: control.reason,
          }),
        });

        await params.activity.recordToolExecution({
          runId: params.runId,
          agentActionId,
          proposalId: control.proposalId,
          toolName: turn.toolName,
          input: turn.toolInput,
          executed: false,
          output: { blocked: true },
          error: control.reason,
        });

        continue;
      }

      if (!control.canExecute) {
        throw new AgentRuntimeLimitError(
          "Control layer denied execution without a clear reason."
        );
      }

      const missionGoal = resolveAgentMission(params.agent).goal ?? null;
      const toolContext = {
        agent: params.agent,
        runId: params.runId,
        userId: params.userId,
        organizationId: params.agent.record.organizationId,
      };

      let lastError: string | null = null;
      let outcome = await executeAuthorizedTool({
        admin: params.admin,
        toolName: turn.toolName,
        toolInput: turn.toolInput,
        actionType,
        context: toolContext,
        safetyDecision: "ALLOW",
        missionGoal,
        agentActionId,
      });

      for (
        let retry = 0;
        !outcome.executed && retry < params.limits.maxRetries;
        retry += 1
      ) {
        lastError = outcome.error ?? "Tool execution failed.";
        outcome = await executeAuthorizedTool({
          admin: params.admin,
          toolName: turn.toolName,
          toolInput: turn.toolInput,
          actionType,
          context: toolContext,
          safetyDecision: "ALLOW",
          missionGoal,
          agentActionId,
        });
      }

      toolCalls += 1;

      if (!outcome.executed) {
        return failRunOnToolError({
          activity: params.activity,
          runId: params.runId,
          toolName: turn.toolName,
          error: outcome.error ?? lastError ?? undefined,
          proposalId: control.proposalId,
          toolCalls,
          turns,
        });
      }

      const afterTool = toolStepLabel(turn.toolName, "after");
      await params.activity.logRunStep({
        runId: params.runId,
        key: `tool.${turn.toolName}.done`,
        label: afterTool.label,
        detail: afterTool.detail ?? "Processing results",
        status: "completed",
      });

      await params.activity.recordToolExecution({
        runId: params.runId,
        agentActionId,
        proposalId: null,
        toolName: turn.toolName,
        input: turn.toolInput,
        executed: outcome.executed,
        output: outcome.output,
        error: null,
      });

      messages.push({
        role: "assistant",
        content: JSON.stringify({
          type: "tool_call",
          toolName: turn.toolName,
          toolInput: turn.toolInput,
        }),
      });

      messages.push({
        role: "tool",
        content: toolResultMessage(outcome),
      });
    }

    throw new AgentRuntimeLimitError(
      `Agent reached the maximum of ${params.limits.maxTurns} turns.`
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Agent run failed unexpectedly.";
    const status =
      err instanceof AgentRuntimeTimeoutError ? "timeout" : "failed";

    await params.activity.finishRun({
      runId: params.runId,
      status,
      summary: null,
      errorMessage: message,
    });

    return {
      runId: params.runId,
      status,
      summary: null,
      error: message,
      proposalId,
      toolCalls,
      turns,
      steps: params.activity.getSteps(),
    };
  }
}

export async function markRunResuming(
  admin: SupabaseClient,
  params: { runId: string; userId: string; metadata: Record<string, unknown> }
): Promise<void> {
  await updateAgentRun(admin, {
    runId: params.runId,
    userId: params.userId,
    status: "running",
    summary: "Continuing after your approval…",
    finishedAt: null,
    metadata: params.metadata,
  });
}
