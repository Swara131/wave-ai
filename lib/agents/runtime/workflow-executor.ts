import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkflowGraphNode } from "@/lib/agents/workflow/types";
import { isTwilioWhatsAppConfigured } from "@/lib/whatsapp/env";
import { summarizeToolResultsForTask } from "./model/summarize-results";
import { formatQueryToolReport } from "./analysis/structured-report";
import type { RecordAnalysisResult } from "./analysis/record-validation";
import { deriveWebSearchQuery } from "./model/task-intent";
import { resolveDatabaseQueryInput } from "./data/resolve-query-source";
import {
  destinationEmailFromAgent,
  destinationPhoneFromAgent,
  setupAnswersFromAgent,
  workflowGraphFromAgent,
  workflowPlanFromGraph,
} from "./execution-plan";
import { resolveToolName } from "@/lib/agents/tools/catalog";
import { executeProtectedTool } from "./protected-tool";
import type { RuntimeActivityLogger } from "./activity/activity-logger";
import type { LoadedAgent, RunAgentResult, RuntimeLimits } from "./types";

function sortedNodes(agent: LoadedAgent): WorkflowGraphNode[] {
  const graph = workflowGraphFromAgent(agent.record);
  if (!graph?.nodes?.length) return [];
  return [...graph.nodes].sort((a, b) => a.position - b.position);
}

export function agentHasPersistedWorkflow(agent: LoadedAgent): boolean {
  return workflowPlanFromGraph(workflowGraphFromAgent(agent.record)).length > 0;
}

function toolInputForNode(params: {
  node: WorkflowGraphNode;
  agent: LoadedAgent;
  task: string;
  summary: string;
}): Record<string, unknown> | null {
  const toolName = resolveToolName(
    params.node.config.toolName ??
      (params.node.type === "output_email" ? "send_email" : "")
  );
  if (!toolName) return null;

  const answers = setupAnswersFromAgent(params.agent.record);

  if (toolName === "web_search" || toolName === "x_search") {
    return { query: deriveWebSearchQuery(params.task, params.agent), count: 5 };
  }

  if (toolName === "send_email") {
    const to = destinationEmailFromAgent(params.agent.record);
    if (!to) return { missing: "email" };
    return {
      to,
      subject: `${params.agent.record.name} result`,
      message: params.summary || "No analysis result was produced yet.",
    };
  }

  if (toolName === "send_whatsapp_message") {
    if (!isTwilioWhatsAppConfigured()) return { missing: "whatsapp_provider" };
    const to = destinationPhoneFromAgent(params.agent.record);
    if (!to) return { missing: "whatsapp" };
    return { to, message: params.summary || "No analysis result was produced yet." };
  }

  if (toolName === "query_supabase") {
    return resolveDatabaseQueryInput({
      agent: params.agent,
      task: params.task,
    });
  }

  if (toolName === "update_crm_record") {
    return {
      ...answers,
      recordId: answers.ticket_id || answers.record_id || answers.customer_id,
      fields: answers,
    };
  }

  if (toolName === "delete_crm_record") {
    return {
      customerId: answers.customer_id || answers.customerId || answers.record_id,
    };
  }

  return { ...answers, task: params.task, summary: params.summary };
}

function isExecutableToolNode(node: WorkflowGraphNode): boolean {
  return Boolean(
    node.config.toolName || node.type === "output_email" || node.type === "tool"
  );
}

export async function runPersistedWorkflow(params: {
  admin: SupabaseClient;
  agent: LoadedAgent;
  userId: string;
  task: string;
  runId: string | null;
  limits: RuntimeLimits;
  activity: RuntimeActivityLogger;
  startNodeIndex?: number;
  initialSummary?: string;
  initialLastToolName?: string | null;
  initialLastToolOutput?: Record<string, unknown>;
  initialToolCalls?: number;
  initialActionSequence?: number;
}): Promise<RunAgentResult> {
  const nodes = sortedNodes(params.agent);
  let summary = params.initialSummary ?? "";
  let analysis: RecordAnalysisResult | undefined;
  let lastToolName: string | null = params.initialLastToolName ?? null;
  let lastToolOutput: Record<string, unknown> = params.initialLastToolOutput ?? {};
  let toolCalls = params.initialToolCalls ?? 0;
  let actionSequence = params.initialActionSequence ?? 0;
  let deliveredEmail = false;
  let deliveredWhatsApp = false;
  let emailMessageId: string | null = null;
  let emailTo: string | null = null;
  let whatsappMessageId: string | null = null;
  const turns = 1;

  const startIndex = Math.max(0, params.startNodeIndex ?? 0);
  for (let nodeIndex = startIndex; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = nodes[nodeIndex];
    await params.activity.logRunStep({
      runId: params.runId,
      key: `workflow.${node.id}`,
      label: node.name,
      detail: node.description,
      status: "running",
    });

    if (node.category === "trigger" || node.category === "safety" || node.category === "logic") {
      await params.activity.logRunStep({
        runId: params.runId,
        key: `workflow.${node.id}.done`,
        label: `${node.name} ✓`,
        detail: node.category === "safety" ? "Policy checks run with each tool" : node.description,
      });
      continue;
    }

    if (node.category === "ai") {
      if (lastToolName === "query_supabase" || lastToolName === "query_database") {
        const formatted = formatQueryToolReport({
          toolOutput: lastToolOutput,
          agent: params.agent.record,
          task: params.task,
        });
        summary = formatted.text;
        analysis = formatted.analysis;
      } else if (lastToolName && Object.keys(lastToolOutput).length > 0 && !analysis) {
        summary = await summarizeToolResultsForTask({
          task: params.task,
          agentName: params.agent.record.name,
          toolName: lastToolName,
          toolOutput: lastToolOutput,
          agentRecord: params.agent.record,
        });
      }
      await params.activity.logRunStep({
        runId: params.runId,
        key: `workflow.${node.id}.done`,
        label: `${node.name} ✓`,
        detail: summary.slice(0, 180),
      });
      continue;
    }

    if (!isExecutableToolNode(node)) {
      continue;
    }

    const toolName = resolveToolName(
      node.config.toolName ?? (node.type === "output_email" ? "send_email" : "")
    );
    if (!toolName || !params.agent.enabledTools.includes(toolName)) {
      const error = toolName
        ? `${node.name} could not run because ${toolName} is not enabled for this agent.`
        : `${node.name} has no executable tool.`;
      await params.activity.finishRun({
        runId: params.runId,
        status: "failed",
        summary: summary || null,
        errorMessage: error,
      });
      return {
        runId: params.runId,
        status: "failed",
        summary: summary || null,
        error,
        proposalId: null,
        toolCalls,
        turns,
        steps: params.activity.getSteps(),
      };
    }

    const toolInput = toolInputForNode({
      node,
      agent: params.agent,
      task: params.task,
      summary,
    });
    if (!toolInput || typeof toolInput.missing === "string") {
      const error =
        toolInput?.missing === "whatsapp_provider"
          ? "WhatsApp is required for this agent, but no WhatsApp provider is connected."
          : toolInput?.missing === "whatsapp"
            ? "WhatsApp is required for this agent, but no recipient is configured."
            : "Email is required for this agent, but no recipient is configured.";
      await params.activity.finishRun({
        runId: params.runId,
        status: "failed",
        summary: summary || null,
        errorMessage: error,
      });
      return {
        runId: params.runId,
        status: "failed",
        summary: summary || null,
        error,
        proposalId: null,
        toolCalls,
        turns,
        steps: params.activity.getSteps(),
      };
    }

    actionSequence += 1;
    const protectedResult = await executeProtectedTool({
      admin: params.admin,
      agent: params.agent,
      userId: params.userId,
      runId: params.runId,
      task: params.task,
      toolName,
      toolInput,
      activity: params.activity,
      toolCalls,
      actionSequence,
      turns,
      maxRetries: params.limits.maxRetries,
      workflowNodeIndex: nodeIndex,
      lastToolName,
      lastToolOutput,
      summary,
    });

    if (protectedResult.kind === "awaiting_approval" || protectedResult.kind === "failed") {
      return protectedResult.result;
    }

    if (protectedResult.kind === "blocked") {
      await params.activity.finishRun({
        runId: params.runId,
        status: "failed",
        summary: null,
        errorMessage: protectedResult.reason,
      });
      return {
        runId: params.runId,
        status: "failed",
        summary: null,
        error: protectedResult.reason,
        proposalId: null,
        toolCalls: protectedResult.toolCalls,
        turns,
        steps: params.activity.getSteps(),
      };
    }

    toolCalls = protectedResult.toolCalls;
    lastToolName = toolName;
    lastToolOutput = protectedResult.outcome.output;
    if (toolName === "send_email") {
      deliveredEmail = true;
      emailMessageId =
        typeof lastToolOutput.messageId === "string" ? lastToolOutput.messageId : null;
      emailTo = typeof toolInput.to === "string" ? toolInput.to : null;
    }
    if (toolName === "send_whatsapp_message") {
      deliveredWhatsApp = true;
      whatsappMessageId =
        typeof lastToolOutput.messageId === "string" ? lastToolOutput.messageId : null;
    }

    if (toolName === "query_supabase" || toolName === "query_database") {
      const formatted = formatQueryToolReport({
        toolOutput: lastToolOutput,
        agent: params.agent.record,
        task: params.task,
      });
      summary = formatted.text;
      analysis = formatted.analysis;
    } else if (
      toolName === "web_search" ||
      toolName === "x_search" ||
      toolName === "google_sheets" ||
      toolName === "read_document"
    ) {
      summary = await summarizeToolResultsForTask({
        task: params.task,
        agentName: params.agent.record.name,
        toolName,
        toolOutput: lastToolOutput,
        agentRecord: params.agent.record,
      });
    } else if (typeof lastToolOutput.messageId === "string" && summary) {
      summary = `${summary}\n\nDelivery message ID: ${lastToolOutput.messageId}`;
    }
  }

  if (!summary.trim()) {
    await params.activity.finishRun({
      runId: params.runId,
      status: "failed",
      summary: null,
      errorMessage: "The workflow finished without producing a result.",
    });
    return {
      runId: params.runId,
      status: "failed",
      summary: null,
      error: "The workflow finished without producing a result.",
      proposalId: null,
      toolCalls,
      turns,
      steps: params.activity.getSteps(),
      analysis,
    };
  }

  await params.activity.finishRun({
    runId: params.runId,
    status: "completed",
    summary,
    metadata: { deliveredEmail, deliveredWhatsApp, workflow: true, analysis },
  });

  return {
    runId: params.runId,
    status: "completed",
    summary,
    error: null,
    proposalId: null,
    toolCalls,
    turns,
    steps: params.activity.getSteps(),
    analysis,
    delivery:
      deliveredEmail || deliveredWhatsApp
        ? {
            mode: deliveredEmail && deliveredWhatsApp ? "both" : deliveredEmail ? "email" : "whatsapp",
            status: "sent",
            destination: emailTo,
            email: deliveredEmail
              ? {
                  status: "sent" as const,
                  destination: emailTo,
                  providerMessageId: emailMessageId,
                  sentAt: new Date().toISOString(),
                }
              : undefined,
            whatsapp: deliveredWhatsApp
              ? {
                  status: "sent" as const,
                  providerMessageId: whatsappMessageId,
                  sentAt: new Date().toISOString(),
                }
              : undefined,
          }
        : undefined,
  };
}
