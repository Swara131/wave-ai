import type { SupabaseClient } from "@supabase/supabase-js";
import { computeActionHash } from "@/lib/gateway/proposals/canonicalize";
import { buildStoredRiskReasons } from "@/lib/gateway/proposals/enrichment";
import {
  findProposalByIdempotencyKey,
  insertActionProposal,
  insertApprovalDecision,
  updateActionProposalPolicyOutcome,
  type ActionProposalRow,
} from "@/lib/gateway/proposals/repository";
import { computeReviewExpiresAt } from "@/lib/gateway/review/config";
import {
  getBuilderAgentRecordById,
  listBuilderAgentsForOrganization,
  updateBuilderAgent,
} from "@/lib/agents/repository";
import type { AgentSafetySettings, BuilderAgentRecord } from "@/lib/agents/runtime-types";
import type { LoadedAgent } from "@/lib/agents/runtime/types";

export const AGENT_ACTIVATE_TOOL = "activate_agent";
export const AGENT_ACTIVATE_ACTION = "agent.activate";

const ACTIVATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function isAgentActivationProposal(row: {
  tool_name?: string;
  action_type?: string;
}): boolean {
  return row.tool_name === AGENT_ACTIVATE_TOOL || row.action_type === AGENT_ACTIVATE_ACTION;
}

export function isAgentActivationApproved(
  agent: Pick<BuilderAgentRecord, "safetySettings">
): boolean {
  return agent.safetySettings?.activation?.status === "approved";
}

function activationIdempotencyKey(builderAgentId: string): string {
  return `activate-${builderAgentId}`;
}

function activationPayload(agent: BuilderAgentRecord, userId: string, runId?: string | null) {
  return {
    agentName: agent.name,
    slug: agent.slug,
    _zeltaBuilderAgentId: agent.id,
    _zeltaRuntimeUserId: userId,
    _zeltaRuntimeRunId: runId ?? null,
    _zeltaActivation: true,
  };
}

async function persistActivationState(
  admin: SupabaseClient,
  agent: BuilderAgentRecord,
  patch: NonNullable<AgentSafetySettings["activation"]>
): Promise<void> {
  const safetySettings: AgentSafetySettings = {
    ...agent.safetySettings,
    activation: {
      ...agent.safetySettings?.activation,
      ...patch,
    },
  };
  await updateBuilderAgent(admin, {
    agentId: agent.id,
    userId: agent.userId,
    patch: { safetySettings },
  });
}

export async function createAgentActivationProposal(
  admin: SupabaseClient,
  params: {
    agent: BuilderAgentRecord;
    userId: string;
    runId?: string | null;
  }
): Promise<ActionProposalRow> {
  const existing = await findProposalByIdempotencyKey(admin, {
    organizationId: params.agent.organizationId,
    agentId: params.agent.slug,
    idempotencyKey: activationIdempotencyKey(params.agent.id),
  });
  if (existing?.status === "approved") {
    return existing;
  }
  if (existing && (existing.status === "review_required" || existing.status === "pending")) {
    if (params.runId && existing.action_payload?._zeltaRuntimeRunId !== params.runId) {
      const nextPayload = {
        ...existing.action_payload,
        _zeltaRuntimeRunId: params.runId,
      };
      await admin
        .from("action_proposals")
        .update({ action_payload: nextPayload })
        .eq("id", existing.id);
      return { ...existing, action_payload: nextPayload };
    }
    return existing;
  }

  const payload = activationPayload(params.agent, params.userId, params.runId);
  const expiresAt = new Date(Date.now() + ACTIVATION_TTL_MS).toISOString();
  const decidedAt = new Date().toISOString();
  const retryKey = existing ? existing.id.slice(0, 8) : "v1";
  const actionHash = computeActionHash({
    organizationId: params.agent.organizationId,
    agentId: params.agent.slug,
    toolName: AGENT_ACTIVATE_TOOL,
    actionType: AGENT_ACTIVATE_ACTION,
    payload: {
      _zeltaBuilderAgentId: params.agent.id,
      _zeltaActivation: true,
      attempt: retryKey,
    },
  });

  const inserted = await insertActionProposal(admin, {
    organizationId: params.agent.organizationId,
    agentId: params.agent.slug,
    toolName: AGENT_ACTIVATE_TOOL,
    actionType: AGENT_ACTIVATE_ACTION,
    actionPayload: payload,
    actionHash,
    expiresAt,
    requestedByUserId: params.userId,
    agentRunId: params.runId ?? null,
    idempotencyKey: existing
      ? `activate-${params.agent.id}-${retryKey}`
      : activationIdempotencyKey(params.agent.id),
  });

  const reviewExpiresAt = computeReviewExpiresAt({
    reviewRequestedAt: new Date(decidedAt),
    proposalExpiresAt: expiresAt,
    deadlineHours: 14 * 24,
  });

  const row = await updateActionProposalPolicyOutcome(admin, {
    proposalId: inserted.id,
    organizationId: params.agent.organizationId,
    status: "review_required",
    policyDecision: "review",
    riskReasons: {
      ...buildStoredRiskReasons(
        [
          {
            policyId: "agent.activation",
            name: "Agent activation",
            decision: "REVIEW",
            reason: "This agent cannot run until you approve it on the Approvals page.",
          },
        ],
        { ok: false, error: "Agent activation requires a human decision." }
      ),
    },
    decidedAt,
    reviewExpiresAt,
    plainEnglishSummary: `${params.agent.name} is waiting for your approval before it can run.`,
    riskLevel: "medium",
    riskScore: 55,
  });

  await insertApprovalDecision(admin, {
    organizationId: params.agent.organizationId,
    actionProposalId: row.id,
    decisionSource: "policy",
    policyDecision: "review",
    proposalStatus: "review_required",
    reason: "New agents must be approved before they can proceed.",
    metadata: { source: "agent_activation", builderAgentId: params.agent.id },
  });

  await persistActivationState(admin, params.agent, {
    status: "pending",
    proposalId: row.id,
  });

  return row;
}

export async function ensureAgentActivationApproval(
  admin: SupabaseClient,
  params: {
    agent: LoadedAgent;
    userId: string;
    runId: string | null;
  }
): Promise<{ approved: true } | { approved: false; proposalId: string; summary: string }> {
  const record = params.agent.record;
  if (isAgentActivationApproved(record)) {
    return { approved: true };
  }

  const proposal = await createAgentActivationProposal(admin, {
    agent: record,
    userId: params.userId,
    runId: params.runId,
  });

  if (proposal.status === "approved") {
    await persistActivationState(admin, record, {
      status: "approved",
      proposalId: proposal.id,
      decidedAt: proposal.decided_at ?? new Date().toISOString(),
    });
    return { approved: true };
  }

  return {
    approved: false,
    proposalId: proposal.id,
    summary: `${record.name} needs your approval on the Approvals page before it can run.`,
  };
}

export async function applyAgentActivationDecision(
  admin: SupabaseClient,
  params: {
    proposal: ActionProposalRow;
    decision: "approved" | "rejected";
    decidedAt: string;
  }
): Promise<{ builderAgentId: string | null }> {
  const payload = params.proposal.action_payload ?? {};
  const builderAgentId =
    typeof payload._zeltaBuilderAgentId === "string" ? payload._zeltaBuilderAgentId : null;
  if (!builderAgentId) return { builderAgentId: null };

  const agent = await getBuilderAgentRecordById(admin, builderAgentId);
  if (!agent) return { builderAgentId };

  await persistActivationState(admin, agent, {
    status: params.decision === "approved" ? "approved" : "rejected",
    proposalId: params.proposal.id,
    decidedAt: params.decidedAt,
  });

  return { builderAgentId };
}

export async function ensurePendingActivationsForOrganization(
  admin: SupabaseClient,
  organizationId: string
): Promise<void> {
  const agents = await listBuilderAgentsForOrganization(admin, organizationId);
  for (const agent of agents) {
    if (isAgentActivationApproved(agent)) continue;
    try {
      await createAgentActivationProposal(admin, {
        agent,
        userId: agent.userId,
      });
    } catch (err) {
      console.warn("[activation] failed to queue approval", {
        agentId: agent.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
