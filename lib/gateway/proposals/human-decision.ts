import type { SupabaseClient } from "@supabase/supabase-js";
import { ProposalError } from "@/lib/gateway/errors";
import { recordAudit } from "@/lib/audit/logger";
import { extractRequestContext } from "@/lib/audit/context";
import { recordRuntimeAuditEventAsync } from "@/lib/gateway/audit/runtime-events";
import {
  effectiveReviewDeadline,
  ensureReviewFreshOrProcessed,
  type ReviewTimeoutDeps,
} from "@/lib/gateway/review/timeout";
import {
  finalizeHumanProposalDecision,
  getActionProposalById,
  insertApprovalDecision,
  listReviewRequiredProposals,
  type ActionProposalRow,
} from "./repository";
import { mapReviewProposalToPendingApproval } from "./review-mapper";
import type { PendingApproval } from "@/lib/approval-types";
import type { RiskSeverity } from "@/lib/risk-types";
import { handleRuntimeProposalDecision } from "@/lib/agents/protection/runtime-bridge";
import { isAgentActivationProposal } from "@/lib/agents/activation/approval";

export type HumanReviewDecision = "approved" | "rejected";

export interface DecideGatewayProposalParams {
  proposalId: string;
  organizationId: string;
  actorId: string;
  actorEmail: string;
  decision: HumanReviewDecision;
  note?: string;
  request?: Request;
}

export interface DecideGatewayProposalResult {
  proposalId: string;
  status: HumanReviewDecision;
  actionHash: string;
  decidedAt: string;
  runtimeResume?: {
    resumed: boolean;
    runId: string | null;
    runStatus?: string;
    runSummary?: string | null;
  };
}

export interface HumanDecisionDeps {
  ensureFresh: typeof ensureReviewFreshOrProcessed;
  finalizeDecision: typeof finalizeHumanProposalDecision;
  insertDecision: typeof insertApprovalDecision;
  recordRuntimeAudit: typeof recordRuntimeAuditEventAsync;
  recordRetrospectiveAudit: typeof recordAudit;
  listReviews: typeof listReviewRequiredProposals;
  getProposal: typeof getActionProposalById;
  reviewTimeoutDeps?: Partial<ReviewTimeoutDeps>;
}

const defaultHumanDecisionDeps: HumanDecisionDeps = {
  ensureFresh: ensureReviewFreshOrProcessed,
  finalizeDecision: finalizeHumanProposalDecision,
  insertDecision: insertApprovalDecision,
  recordRuntimeAudit: recordRuntimeAuditEventAsync,
  recordRetrospectiveAudit: recordAudit,
  listReviews: listReviewRequiredProposals,
  getProposal: getActionProposalById,
};

export async function listGatewayPendingApprovals(
  supabase: SupabaseClient,
  organizationId: string,
  deps: Pick<HumanDecisionDeps, "listReviews" | "ensureFresh"> = defaultHumanDecisionDeps
): Promise<PendingApproval[]> {
  const rows = await deps.listReviews(supabase, organizationId);
  const refreshed: ActionProposalRow[] = [];

  for (const row of rows) {
    if (isAgentActivationProposal(row)) {
      if (row.status === "review_required") {
        refreshed.push(row);
      }
      continue;
    }
    try {
      const current = await deps.ensureFresh(supabase, {
        proposalId: row.id,
        organizationId,
      });
      if (current?.status === "review_required") {
        refreshed.push(current);
      }
    } catch {
      if (row.status === "review_required") {
        refreshed.push(row);
      }
    }
  }

  return refreshed.map(mapReviewProposalToPendingApproval);
}

export async function decideGatewayProposalReview(
  readClient: SupabaseClient,
  writeClient: SupabaseClient,
  params: DecideGatewayProposalParams,
  deps: HumanDecisionDeps = defaultHumanDecisionDeps
): Promise<DecideGatewayProposalResult> {
  const existing = await deps.ensureFresh(
    writeClient,
    {
      proposalId: params.proposalId,
      organizationId: params.organizationId,
    },
    { deps: deps.reviewTimeoutDeps }
  );

  if (!existing) {
    throw new ProposalError("Action proposal not found.");
  }

  if (existing.status === "rejected" || existing.status === "expired") {
    throw new ProposalError("This approval has expired and cannot be executed.");
  }

  if (existing.status !== "review_required") {
    throw new ProposalError("This approval has already been resolved.");
  }

  const reviewDeadline = effectiveReviewDeadline(existing);
  const decidedAt = new Date().toISOString();

  if (
    !isAgentActivationProposal(existing) &&
    new Date(reviewDeadline) <= new Date(decidedAt)
  ) {
    throw new ProposalError("Review deadline has expired for this proposal.");
  }

  const proposalStatus = params.decision;
  const auditCtx = extractRequestContext(params.request);

  const updated = await deps.finalizeDecision(writeClient, {
    proposalId: params.proposalId,
    organizationId: params.organizationId,
    actionHash: existing.action_hash,
    status: proposalStatus,
    decidedAt,
    reviewExpiresAt: reviewDeadline,
  });

  await deps.insertDecision(writeClient, {
    organizationId: params.organizationId,
    actionProposalId: params.proposalId,
    decisionSource: "human",
    policyDecision: existing.policy_decision as "review" | null,
    proposalStatus,
    actorId: params.actorId,
    reason: params.note ?? null,
    metadata: {
      actionHash: existing.action_hash,
      reviewerEmail: params.actorEmail,
      toolName: existing.tool_name,
      actionType: existing.action_type,
      decidedAt,
      reviewExpiresAt: reviewDeadline,
    },
  });

  deps.recordRuntimeAudit(writeClient, {
    organizationId: params.organizationId,
    proposalId: params.proposalId,
    event: params.decision === "approved" ? "approval.approved" : "approval.rejected",
    actorId: params.actorId,
    agentId: existing.agent_id,
    metadata: {
      actionHash: existing.action_hash,
      note: params.note ?? null,
      reviewerEmail: params.actorEmail,
      toolName: existing.tool_name,
      actionType: existing.action_type,
      riskLevel: existing.risk_level,
      reviewExpiresAt: reviewDeadline,
    },
    ipAddress: auditCtx.ipAddress,
    userAgent: auditCtx.userAgent,
  });

  await deps.recordRetrospectiveAudit(readClient, {
    request: params.request,
    userId: params.actorId,
    organizationId: params.organizationId,
    action: params.decision === "approved" ? "approve" : "reject",
    entityType: "action_proposal",
    entityId: params.proposalId,
    riskSeverity: existing.risk_level as RiskSeverity,
    approvalStatus: proposalStatus,
    metadata: {
      description:
        params.decision === "approved"
          ? `Human approved gateway proposal ${existing.tool_name}`
          : `Human rejected gateway proposal ${existing.tool_name}`,
      actionHash: existing.action_hash,
      note: params.note,
      agentId: existing.agent_id,
      reviewExpiresAt: reviewDeadline,
      toolName: existing.tool_name,
      actionType: existing.action_type,
      riskScore: existing.risk_score,
      riskLevel: existing.risk_level,
    },
  });

  let runtimeResume: DecideGatewayProposalResult["runtimeResume"];

  try {
    const bridge = await handleRuntimeProposalDecision(readClient, {
      proposal: existing,
      userId: params.actorId,
      userEmail: params.actorEmail,
      decision: params.decision,
      note: params.note,
    });
    runtimeResume = {
      resumed: bridge.resumed,
      runId: bridge.runId,
      runStatus: bridge.runResult?.status,
      runSummary: bridge.runResult?.summary,
    };
  } catch (err) {
    console.error("Runtime agent resume after approval failed:", err);
    runtimeResume = {
      resumed: false,
      runId: null,
    };
  }

  return {
    proposalId: updated.id,
    status: params.decision,
    actionHash: updated.action_hash,
    decidedAt,
    runtimeResume,
  };
}
