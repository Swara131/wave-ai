import type { SupabaseClient } from "@supabase/supabase-js";
import { recordRuntimeAuditEventAsync } from "@/lib/gateway/audit/runtime-events";
import type { StoredRiskReasons } from "@/lib/gateway/proposals/enrichment";
import type { ActionProposalRow } from "@/lib/gateway/proposals/repository";
import {
  autoDenyExpiredReviewAtomically,
  escalateExpiredReviewAtomically,
  getActionProposalById,
  insertApprovalDecision,
} from "@/lib/gateway/proposals/repository";
import {
  computeReviewExpiresAt,
  getReviewDeadlineHours,
  getReviewEscalationMaxLevel,
  getReviewTimeoutBehavior,
  type ReviewTimeoutBehavior,
} from "./config";
import { isAgentActivationProposal } from "@/lib/agents/activation/approval";

export interface StoredReviewEscalation {
  level: number;
  escalatedAt: string;
  priorDeadline: string;
  newDeadline: string;
  reason: string;
}

export type ReviewTimeoutOutcome = "none" | "auto_denied" | "escalated";

export interface ReviewTimeoutResult {
  row: ActionProposalRow;
  outcome: ReviewTimeoutOutcome;
}

export interface ReviewTimeoutDeps {
  getProposal: typeof getActionProposalById;
  autoDeny: typeof autoDenyExpiredReviewAtomically;
  escalate: typeof escalateExpiredReviewAtomically;
  insertDecision: typeof insertApprovalDecision;
  recordAudit: typeof recordRuntimeAuditEventAsync;
}

const defaultDeps: ReviewTimeoutDeps = {
  getProposal: getActionProposalById,
  autoDeny: autoDenyExpiredReviewAtomically,
  escalate: escalateExpiredReviewAtomically,
  insertDecision: insertApprovalDecision,
  recordAudit: recordRuntimeAuditEventAsync,
};

export function effectiveReviewDeadline(row: ActionProposalRow): string {
  return row.review_expires_at ?? row.expires_at;
}

export function isReviewDeadlineExpired(
  row: ActionProposalRow,
  now: Date = new Date()
): boolean {
  if (row.status !== "review_required") {
    return false;
  }
  return new Date(effectiveReviewDeadline(row)) <= now;
}

function parseStoredRiskReasons(value: unknown): StoredRiskReasons {
  if (typeof value === "object" && value !== null && "matchedPolicies" in value) {
    return value as StoredRiskReasons;
  }
  return { matchedPolicies: [] };
}

function currentEscalationLevel(riskReasons: unknown): number {
  const stored = parseStoredRiskReasons(riskReasons);
  return stored.reviewEscalation?.level ?? 0;
}

function buildEscalationRecord(params: {
  level: number;
  priorDeadline: string;
  newDeadline: string;
  processedAt: string;
}): StoredReviewEscalation {
  return {
    level: params.level,
    escalatedAt: params.processedAt,
    priorDeadline: params.priorDeadline,
    newDeadline: params.newDeadline,
    reason: `Review deadline passed without human action (escalation level ${params.level}).`,
  };
}

function auditReviewExpired(
  supabase: SupabaseClient,
  row: ActionProposalRow,
  processedAt: string,
  recordAudit: ReviewTimeoutDeps["recordAudit"]
): void {
  recordAudit(supabase, {
    organizationId: row.organization_id,
    proposalId: row.id,
    event: "review.expired",
    agentId: row.agent_id,
    metadata: {
      actionHash: row.action_hash,
      reviewExpiresAt: effectiveReviewDeadline(row),
      processedAt,
      toolName: row.tool_name,
      actionType: row.action_type,
    },
  });
}

async function performAutoDeny(
  supabase: SupabaseClient,
  row: ActionProposalRow,
  processedAt: string,
  deps: ReviewTimeoutDeps
): Promise<ActionProposalRow | null> {
  auditReviewExpired(supabase, row, processedAt, deps.recordAudit);

  const updated = await deps.autoDeny(supabase, {
    proposalId: row.id,
    organizationId: row.organization_id,
    actionHash: row.action_hash,
    processedAt,
  });

  if (!updated) {
    return deps.getProposal(supabase, {
      proposalId: row.id,
      organizationId: row.organization_id,
    });
  }

  await deps.insertDecision(supabase, {
    organizationId: row.organization_id,
    actionProposalId: row.id,
    decisionSource: "system",
    policyDecision: row.policy_decision as "review" | null,
    proposalStatus: "expired",
    reason: "Review deadline expired; the action was not executed.",
    metadata: {
      actionHash: row.action_hash,
      reviewExpiresAt: effectiveReviewDeadline(row),
      processedAt,
      timeoutBehavior: "auto_deny",
    },
  });

  deps.recordAudit(supabase, {
    organizationId: row.organization_id,
    proposalId: row.id,
    event: "review.auto_denied",
    agentId: row.agent_id,
    metadata: {
      actionHash: row.action_hash,
      reviewExpiresAt: effectiveReviewDeadline(row),
      processedAt,
      toolName: row.tool_name,
      actionType: row.action_type,
    },
  });

  const payload = row.action_payload ?? {};
  const runId =
    typeof payload._zeltaRuntimeRunId === "string" ? payload._zeltaRuntimeRunId : null;
  if (runId) {
    try {
      await supabase
        .from("agent_runs")
        .update({
          status: "cancelled",
          error_message: "Approval expired. The protected action was not executed.",
          finished_at: processedAt,
        })
        .eq("id", runId)
        .eq("status", "awaiting_approval");
    } catch (err) {
      console.warn("[review-timeout] failed to expire linked run", {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return updated;
}

async function performEscalation(
  supabase: SupabaseClient,
  row: ActionProposalRow,
  processedAt: string,
  deps: ReviewTimeoutDeps,
  deadlineHours: number
): Promise<ActionProposalRow | null> {
  const priorDeadline = effectiveReviewDeadline(row);
  const nextLevel = currentEscalationLevel(row.risk_reasons) + 1;
  const newDeadline = computeReviewExpiresAt({
    reviewRequestedAt: new Date(processedAt),
    proposalExpiresAt: row.expires_at,
    deadlineHours,
  });

  auditReviewExpired(supabase, row, processedAt, deps.recordAudit);

  const escalation = buildEscalationRecord({
    level: nextLevel,
    priorDeadline,
    newDeadline,
    processedAt,
  });

  const stored = parseStoredRiskReasons(row.risk_reasons);
  const updatedRiskReasons: StoredRiskReasons = {
    ...stored,
    reviewEscalation: escalation,
  };

  const updated = await deps.escalate(supabase, {
    proposalId: row.id,
    organizationId: row.organization_id,
    actionHash: row.action_hash,
    priorDeadline,
    processedAt,
    reviewExpiresAt: newDeadline,
    riskReasons: updatedRiskReasons,
  });

  if (!updated) {
    return deps.getProposal(supabase, {
      proposalId: row.id,
      organizationId: row.organization_id,
    });
  }

  deps.recordAudit(supabase, {
    organizationId: row.organization_id,
    proposalId: row.id,
    event: "review.escalated",
    agentId: row.agent_id,
    metadata: {
      actionHash: row.action_hash,
      escalationLevel: nextLevel,
      priorDeadline,
      newDeadline,
      processedAt,
      toolName: row.tool_name,
      actionType: row.action_type,
    },
  });

  return updated;
}

/**
 * Applies review timeout when deadline has passed. Idempotent and race-safe via atomic DB updates.
 * Never auto-approves.
 */
export async function applyReviewTimeoutIfExpired(
  supabase: SupabaseClient,
  row: ActionProposalRow,
  options: {
    now?: Date;
    timeoutBehavior?: ReviewTimeoutBehavior;
    escalationMaxLevel?: number;
    deadlineHours?: number;
    deps?: Partial<ReviewTimeoutDeps>;
  } = {}
): Promise<ReviewTimeoutResult> {
  const deps: ReviewTimeoutDeps = { ...defaultDeps, ...options.deps };
  const now = options.now ?? new Date();
  const processedAt = now.toISOString();

  if (row.status !== "review_required" || !isReviewDeadlineExpired(row, now)) {
    return { row, outcome: "none" };
  }

  if (isAgentActivationProposal(row)) {
    return { row, outcome: "none" };
  }

  const timeoutBehavior = options.timeoutBehavior ?? getReviewTimeoutBehavior();
  const escalationMaxLevel = options.escalationMaxLevel ?? getReviewEscalationMaxLevel();
  const deadlineHours = options.deadlineHours ?? getReviewDeadlineHours();
  const escalationLevel = currentEscalationLevel(row.risk_reasons);

  if (
    timeoutBehavior === "auto_deny" ||
    escalationLevel >= escalationMaxLevel
  ) {
    const updated =
      (await performAutoDeny(supabase, row, processedAt, deps)) ?? row;
    return {
      row: updated,
      outcome:
        updated.status === "expired" || updated.status === "rejected"
          ? "auto_denied"
          : "none",
    };
  }

  const updated =
    (await performEscalation(supabase, row, processedAt, deps, deadlineHours)) ??
    row;

  if (
    updated.status === "review_required" &&
    updated.review_expires_at &&
    new Date(updated.review_expires_at) > now
  ) {
    return { row: updated, outcome: "escalated" };
  }

  return { row: updated, outcome: "none" };
}

export async function ensureReviewFreshOrProcessed(
  supabase: SupabaseClient,
  params: { proposalId: string; organizationId: string },
  options: {
    now?: Date;
    deps?: Partial<ReviewTimeoutDeps>;
  } = {}
): Promise<ActionProposalRow | null> {
  const deps: ReviewTimeoutDeps = { ...defaultDeps, ...options.deps };
  const row = await deps.getProposal(supabase, params);
  if (!row) {
    return null;
  }

  const { row: current } = await applyReviewTimeoutIfExpired(supabase, row, {
    now: options.now,
    deps: options.deps,
  });
  return current;
}

export function recordReviewDeadlineSet(
  supabase: SupabaseClient,
  params: {
    organizationId: string;
    proposalId: string;
    agentId: string;
    actionHash: string;
    reviewExpiresAt: string;
    decidedAt: string;
    toolName: string;
    actionType: string;
  }
): void {
  recordRuntimeAuditEventAsync(supabase, {
    organizationId: params.organizationId,
    proposalId: params.proposalId,
    event: "review.deadline_set",
    agentId: params.agentId,
    metadata: {
      actionHash: params.actionHash,
      reviewExpiresAt: params.reviewExpiresAt,
      decidedAt: params.decidedAt,
      toolName: params.toolName,
      actionType: params.actionType,
    },
  });
}
