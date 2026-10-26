import type { SupabaseClient } from "@supabase/supabase-js";
import { getBuilderAgentRecordById, updateBuilderAgent } from "@/lib/agents/repository";
import type { ActionProposalRow } from "@/lib/gateway/proposals/repository";
import {
  CREATE_QUOTE_TOOL,
  REQUEST_VISIT_TOOL,
  VERIFY_ADDRESS_TOOL,
} from "./constants";
import {
  getLightingJobForUser,
  isMissingLightingTable,
  lightingJobsFromSafety,
  mergeLightingJobIntoSafety,
  updateLightingJob,
} from "./repository";
import { notifyLightingVisitRequest } from "./notify";
import type { LightingJob } from "./types";
import { buildVisitRequestOutput } from "./workflow";

export function isLightingConciergeProposal(row: {
  tool_name?: string;
  action_payload?: Record<string, unknown>;
}): boolean {
  const tools = new Set([CREATE_QUOTE_TOOL, VERIFY_ADDRESS_TOOL, REQUEST_VISIT_TOOL]);
  if (row.tool_name && tools.has(row.tool_name)) return true;
  return Boolean(row.action_payload?._lightingJobId);
}

async function loadJobForDecision(
  admin: SupabaseClient,
  params: { jobId: string; userId: string; agentId: string }
): Promise<LightingJob | null> {
  const fromTable = await getLightingJobForUser(admin, params);
  if (fromTable) return fromTable;
  const agent = await getBuilderAgentRecordById(admin, params.agentId);
  if (!agent) return null;
  return lightingJobsFromSafety(agent.safetySettings).find((item) => item.id === params.jobId) ?? null;
}

async function persistDecisionJob(
  admin: SupabaseClient,
  params: { job: LightingJob; userId: string; agentId: string }
): Promise<void> {
  const writeFallback = async () => {
    const agent = await getBuilderAgentRecordById(admin, params.agentId);
    if (!agent) return;
    await updateBuilderAgent(admin, {
      agentId: agent.id,
      userId: agent.userId,
      patch: { safetySettings: mergeLightingJobIntoSafety(agent.safetySettings, params.job) },
    });
  };

  const existing = await getLightingJobForUser(admin, {
    jobId: params.job.id,
    userId: params.userId,
    agentId: params.agentId,
  });
  if (!existing) {
    await writeFallback();
    return;
  }

  try {
    await updateLightingJob(admin, {
      jobId: params.job.id,
      userId: params.userId,
      patch: {
        quote: params.job.quote,
        safety: params.job.safety,
        address: params.job.address,
        appointment: params.job.appointment,
      },
    });
  } catch (error) {
    if (!isMissingLightingTable(error)) throw error;
    await writeFallback();
  }
}

export function applyLightingDecisionToJob(
  job: LightingJob,
  params: {
    toolName: string;
    decision: "approved" | "rejected";
    actorId: string;
    note?: string;
    decidedAt: string;
    proposalId: string;
  }
): LightingJob {
  const approved = params.decision === "approved";
  const safety: LightingJob["safety"] = {
    ...job.safety,
    approvalStatus: approved ? "approved" : "rejected",
    executionStatus: approved ? "executed" : "rejected",
    timestamp: params.decidedAt,
    proposalId: params.proposalId,
  };

  if (params.toolName === VERIFY_ADDRESS_TOOL) {
    const verified: LightingJob = {
      ...job,
      updatedAt: params.decidedAt,
      address: {
        ...job.address,
        status: approved ? "verified" : "rejected",
        proposalId: params.proposalId,
        verifiedAt: approved ? params.decidedAt : null,
        verifiedBy: approved ? params.actorId : null,
        note: params.note ?? (approved ? "Verified by an authorised reviewer." : "Rejected by reviewer."),
        method: "manual_reviewer",
      },
      safety,
    };
    if (
      approved &&
      (job.appointment.status === "awaiting_approval" || job.appointment.status === "blocked" || job.appointment.status === "none")
    ) {
      return {
        ...verified,
        appointment: buildVisitRequestOutput({
          job: verified,
          requestedAt: params.decidedAt,
          proposalId: job.appointment.proposalId ?? params.proposalId,
          preferredAt: job.appointment.preferredAt,
        }),
      };
    }
    return verified;
  }

  if (params.toolName === CREATE_QUOTE_TOOL) {
    return {
      ...job,
      updatedAt: params.decidedAt,
      quote: {
        ...job.quote,
        status: approved ? "approved" : "rejected",
      },
      safety,
    };
  }

  if (params.toolName === REQUEST_VISIT_TOOL) {
    return {
      ...job,
      updatedAt: params.decidedAt,
      appointment: approved
        ? buildVisitRequestOutput({
            job,
            requestedAt: params.decidedAt,
            proposalId: params.proposalId,
            preferredAt: job.appointment.preferredAt,
          })
        : {
            status: "rejected",
            requestedAt: params.decidedAt,
            preferredAt: job.appointment.preferredAt ?? null,
            proposalId: params.proposalId,
            note: params.note ?? "Visit request rejected.",
            customerConfirmed: true,
          },
      safety,
    };
  }

  return { ...job, safety, updatedAt: params.decidedAt };
}

export async function applyLightingProposalDecision(
  admin: SupabaseClient,
  params: {
    proposal: ActionProposalRow;
    decision: "approved" | "rejected";
    actorId: string;
    note?: string;
    decidedAt: string;
  }
): Promise<void> {
  const payload = params.proposal.action_payload ?? {};
  const jobId = typeof payload._lightingJobId === "string" ? payload._lightingJobId : null;
  const userId =
    typeof payload._zeltaRuntimeUserId === "string" ? payload._zeltaRuntimeUserId : params.actorId;
  const agentId =
    typeof payload._zeltaBuilderAgentId === "string" ? payload._zeltaBuilderAgentId : null;
  if (!jobId || !agentId) return;

  const job = await loadJobForDecision(admin, { jobId, userId, agentId });
  if (!job) return;

  let next = applyLightingDecisionToJob(job, {
    toolName: params.proposal.tool_name,
    decision: params.decision,
    actorId: params.actorId,
    note: params.note,
    decidedAt: params.decidedAt,
    proposalId: params.proposal.id,
  });
  if (next.appointment.status === "pending_confirmation") {
    const agent = await getBuilderAgentRecordById(admin, agentId);
    if (agent) {
      next = await notifyLightingVisitRequest(admin, { agent, job: next });
    }
  }
  await persistDecisionJob(admin, { job: next, userId, agentId });
}
