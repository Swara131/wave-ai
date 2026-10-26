import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAgentRunById } from "../runtime-repository";
import type { PendingRuntimeApproval } from "../protection/types";
import { loadAgentForRuntime } from "./agent-loader";
import { RuntimeActivityLogger } from "./activity/activity-logger";
import { resolveRuntimeLimits } from "./config";
import { AgentNotRunnableError } from "./errors";
import { executeApprovedAction, revokeApprovalPassport } from "@/lib/safety/approval-gate/gate";
import { resolveAgentMission } from "@/lib/safety/mission";
import { markRunResuming, runAgentLoop } from "./run-loop";
import { agentHasPersistedWorkflow, runPersistedWorkflow } from "./workflow-executor";
import { AGENT_ACTIVATE_TOOL } from "@/lib/agents/activation/approval";
import type { ModelMessage, RunAgentResult } from "./types";
import { updateAgentRun } from "../runtime-repository";

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

function parsePendingApproval(metadata: Record<string, unknown>): PendingRuntimeApproval | null {
  const pending = metadata.pendingApproval;
  if (!pending || typeof pending !== "object") return null;
  const record = pending as Record<string, unknown>;
  if (
    typeof record.proposalId !== "string" ||
    typeof record.toolName !== "string" ||
    typeof record.passportId !== "string"
  ) {
    return null;
  }
  return {
    proposalId: record.proposalId,
    passportId: record.passportId,
    toolName: record.toolName,
    toolInput: (record.toolInput as Record<string, unknown>) ?? {},
    actionType: typeof record.actionType === "string" ? record.actionType : record.toolName,
    agentActionId:
      typeof record.agentActionId === "string" ? record.agentActionId : null,
    turns: typeof record.turns === "number" ? record.turns : 0,
    toolCalls: typeof record.toolCalls === "number" ? record.toolCalls : 0,
    actionSequence: typeof record.actionSequence === "number" ? record.actionSequence : 0,
    messages: Array.isArray(record.messages)
      ? (record.messages as Array<{ role: string; content: string }>)
      : [],
    protectionReason:
      typeof record.protectionReason === "string" ? record.protectionReason : "",
    riskLevel:
      (record.riskLevel as PendingRuntimeApproval["riskLevel"]) ?? "medium",
    workflowNodeIndex:
      typeof record.workflowNodeIndex === "number" ? record.workflowNodeIndex : undefined,
    lastToolName: typeof record.lastToolName === "string" ? record.lastToolName : null,
    lastToolOutput:
      record.lastToolOutput && typeof record.lastToolOutput === "object"
        ? (record.lastToolOutput as Record<string, unknown>)
        : {},
    summary: typeof record.summary === "string" ? record.summary : undefined,
  };
}

export async function resumeAgentRunAfterApproval(
  supabase: SupabaseClient,
  params: {
    runId: string;
    userId: string;
    userEmail: string;
    proposalId: string;
  }
): Promise<RunAgentResult> {
  const admin = createAdminClient();
  const run = await getAgentRunById(supabase, {
    runId: params.runId,
    userId: params.userId,
  });

  if (!run) {
    throw new AgentNotRunnableError("Agent run not found.");
  }

  if (run.status !== "awaiting_approval") {
    throw new AgentNotRunnableError("This agent run is not waiting for approval.");
  }

  const pending = parsePendingApproval(run.metadata ?? {});
  if (!pending || pending.proposalId !== params.proposalId) {
    throw new AgentNotRunnableError("Approval details for this run could not be found.");
  }
  if (pending.toolName === AGENT_ACTIVATE_TOOL) {
    return resumeAgentRunAfterActivation(supabase, params);
  }

  const agent = await loadAgentForRuntime(supabase, {
    agentDbId: run.agentId,
    userId: params.userId,
  });

  const limits = resolveRuntimeLimits(agent.record);
  const activity = new RuntimeActivityLogger(admin, agent, params.userId, limits);
  const task =
    typeof run.metadata?.task === "string"
      ? run.metadata.task
      : "Continue approved agent action";

  const messages: ModelMessage[] = pending.messages.map((message) => ({
    role: message.role as ModelMessage["role"],
    content: message.content,
  }));

  await markRunResuming(admin, {
    runId: params.runId,
    userId: params.userId,
    metadata: {
      ...run.metadata,
      pendingApproval: null,
    },
  });

  await activity.logRunStep({
    runId: params.runId,
    key: "protection.approved",
    label: "You approved this action",
    detail: pending.toolName,
  });

  const missionGoal = resolveAgentMission(agent).goal ?? null;
  const toolContext = {
    agent,
    runId: params.runId,
    userId: params.userId,
    organizationId: agent.record.organizationId,
  };

  const outcome = await executeApprovedAction({
    admin,
    proposalId: pending.proposalId,
    passportId: pending.passportId,
    toolName: pending.toolName,
    toolInput: pending.toolInput,
    actionType: pending.actionType,
    context: toolContext,
    missionGoal,
    agentActionId: pending.agentActionId,
    userEmail: params.userEmail,
  });

  await activity.recordToolExecution({
    runId: params.runId,
    agentActionId: pending.agentActionId,
    proposalId: params.proposalId,
    toolName: pending.toolName,
    input: pending.toolInput,
    executed: outcome.executed,
    output: outcome.output,
    error: outcome.executed ? null : outcome.error ?? "Tool execution failed.",
  });

  messages.push({
    role: "assistant",
    content: JSON.stringify({
      type: "tool_call",
      toolName: pending.toolName,
      toolInput: pending.toolInput,
      approvedByUser: true,
    }),
  });
  messages.push({
    role: "tool",
    content: toolResultMessage(outcome),
  });

  if (!outcome.executed) {
    const error = outcome.error ?? "The approved action could not be executed.";
    await activity.finishRun({
      runId: params.runId,
      status: "failed",
      summary: pending.summary ?? null,
      errorMessage: error,
      metadata: {
        ...run.metadata,
        pendingApproval: null,
        approvalExecutionFailed: true,
      },
    });
    return {
      runId: params.runId,
      status: "failed",
      summary: pending.summary ?? null,
      error,
      proposalId: params.proposalId,
      toolCalls: pending.toolCalls + 1,
      turns: pending.turns,
      steps: activity.getSteps(),
    };
  }

  if (typeof pending.workflowNodeIndex === "number") {
    const summary =
      pending.summary ||
      (typeof outcome.output.message === "string"
        ? outcome.output.message
        : `${pending.toolName.replace(/_/g, " ")} completed.`);
    return runPersistedWorkflow({
      admin,
      agent,
      userId: params.userId,
      task,
      runId: params.runId,
      limits,
      activity,
      startNodeIndex: pending.workflowNodeIndex + 1,
      initialSummary: summary,
      initialLastToolName: pending.toolName,
      initialLastToolOutput: outcome.output,
      initialToolCalls: pending.toolCalls + 1,
      initialActionSequence: pending.actionSequence,
    });
  }

  return runAgentLoop({
    admin,
    agent,
    userId: params.userId,
    task,
    runId: params.runId,
    limits,
    activity,
    initialState: {
      messages,
      toolCalls: pending.toolCalls + 1,
      turns: pending.turns,
      actionSequence: pending.actionSequence,
      proposalId: null,
    },
  });
}

export async function resumeAgentRunAfterActivation(
  supabase: SupabaseClient,
  params: {
    runId: string;
    userId: string;
    userEmail: string;
    proposalId: string;
  }
): Promise<RunAgentResult> {
  const admin = createAdminClient();
  const run = await getAgentRunById(supabase, {
    runId: params.runId,
    userId: params.userId,
  });

  if (!run) {
    throw new AgentNotRunnableError("Agent run not found.");
  }

  if (run.status !== "awaiting_approval") {
    throw new AgentNotRunnableError("This agent run is not waiting for approval.");
  }

  const pending = parsePendingApproval(run.metadata ?? {});
  if (pending && pending.proposalId !== params.proposalId) {
    throw new AgentNotRunnableError("Approval details for this run could not be found.");
  }

  const agent = await loadAgentForRuntime(supabase, {
    agentDbId: run.agentId,
    userId: params.userId,
  });

  const limits = resolveRuntimeLimits(agent.record);
  const activity = new RuntimeActivityLogger(admin, agent, params.userId, limits);
  const task =
    typeof run.metadata?.task === "string"
      ? run.metadata.task
      : "Continue approved agent action";

  await markRunResuming(admin, {
    runId: params.runId,
    userId: params.userId,
    metadata: {
      ...run.metadata,
      pendingApproval: null,
    },
  });

  await activity.logRunStep({
    runId: params.runId,
    key: "agent.activation.approved",
    label: "You approved this agent",
    detail: agent.record.name,
  });

  if (agentHasPersistedWorkflow(agent)) {
    return runPersistedWorkflow({
      admin,
      agent,
      userId: params.userId,
      task,
      runId: params.runId,
      limits,
      activity,
    });
  }

  return runAgentLoop({
    admin,
    agent,
    userId: params.userId,
    task,
    runId: params.runId,
    limits,
    activity,
  });
}

export async function cancelAgentRunAfterRejection(
  supabase: SupabaseClient,
  params: {
    runId: string;
    userId: string;
    proposalId: string;
    reason?: string;
  }
): Promise<void> {
  const admin = createAdminClient();
  const run = await getAgentRunById(supabase, {
    runId: params.runId,
    userId: params.userId,
  });

  if (!run || run.status !== "awaiting_approval") {
    return;
  }

  const pending = parsePendingApproval(run.metadata ?? {});
  if (pending && pending.proposalId !== params.proposalId) {
    return;
  }

  if (pending && !pending.passportId.startsWith("activation:")) {
    await revokeApprovalPassport(admin, pending.passportId);
  }

  try {
    const agent = await loadAgentForRuntime(supabase, {
      agentDbId: run.agentId,
      userId: params.userId,
    });
    const limits = resolveRuntimeLimits(agent.record);
    const activity = new RuntimeActivityLogger(admin, agent, params.userId, limits);
    await activity.logRunStep({
      runId: params.runId,
      key: "protection.denied",
      label: "Action denied",
      detail: params.reason ?? "You denied this action. It was not executed.",
      status: "blocked",
    });
  } catch {
    // Run status below is the source of truth if step persistence fails.
  }

  await updateAgentRun(admin, {
    runId: params.runId,
    userId: params.userId,
    status: "cancelled",
    summary: "Action denied. The protected tool was not executed.",
    errorMessage: params.reason ?? "Action rejected by user.",
    finishedAt: new Date().toISOString(),
    metadata: {
      ...run.metadata,
      pendingApproval: null,
    },
  });
}
