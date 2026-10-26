import type { SupabaseClient } from "@supabase/supabase-js";
import { getBuilderAgentRecordById, updateBuilderAgent } from "@/lib/agents/repository";
import type { ActionProposalRow } from "@/lib/gateway/proposals/repository";
import { PLAN_GROUP_TOOL, REQUEST_RESERVATION_TOOL } from "./constants";
import {
  getGroupOutingForUser,
  isMissingGroupTable,
  mergeGroupOutingIntoSafety,
  updateGroupOuting,
  groupOutingsFromSafety,
} from "./repository";
import type { GroupOuting } from "./types";

export function isGroupPlannerProposal(row: {
  tool_name?: string;
  action_payload?: Record<string, unknown>;
}): boolean {
  if (row.tool_name === PLAN_GROUP_TOOL || row.tool_name === REQUEST_RESERVATION_TOOL) return true;
  return Boolean(row.action_payload?._groupOutingId);
}

export function groupDecisionIsAuthorized(eventUserId: string, claimedUserId: string): boolean {
  return eventUserId === claimedUserId;
}

export function applyGroupDecisionToOuting(
  outing: GroupOuting,
  params: { toolName: string; decision: "approved" | "rejected"; proposalId: string; decidedAt: string; note?: string }
): GroupOuting {
  const approved = params.decision === "approved";
  const safety: GroupOuting["safety"] = {
    ...outing.safety,
    approvalStatus: approved ? "approved" : "rejected",
    executionStatus: approved ? "executed" : "rejected",
    timestamp: params.decidedAt,
    proposalId: params.proposalId,
  };
  if (params.toolName !== REQUEST_RESERVATION_TOOL || !outing.reservation) {
    return { ...outing, safety, updatedAt: params.decidedAt };
  }
  return {
    ...outing,
    updatedAt: params.decidedAt,
    safety,
    reservation: {
      ...outing.reservation,
      status: approved ? "pending_confirmation" : "rejected",
      note: approved
        ? "Approved as a pending confirmation request. WAVE has no booking provider, so this table is not reserved."
        : params.note ?? "Reservation request rejected.",
      reference: null,
    },
    itinerary: outing.itinerary
      ? { ...outing.itinerary, reservationStatus: approved ? "pending_confirmation" : "rejected" }
      : outing.itinerary,
  };
}

export async function applyGroupProposalDecision(
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
  const outingId = typeof payload._groupOutingId === "string" ? payload._groupOutingId : null;
  const userId =
    typeof payload._zeltaRuntimeUserId === "string" ? payload._zeltaRuntimeUserId : params.actorId;
  const agentId =
    typeof payload._zeltaBuilderAgentId === "string" ? payload._zeltaBuilderAgentId : null;
  if (!outingId || !agentId) return;

  const outing =
    (await getGroupOutingForUser(admin, { outingId, userId, agentId })) ??
    groupOutingsFromSafety((await getBuilderAgentRecordById(admin, agentId))?.safetySettings)?.find(
      (item) => item.id === outingId
    ) ??
    null;
  if (!outing) return;
  if (!groupDecisionIsAuthorized(outing.userId, userId)) return;

  const next = applyGroupDecisionToOuting(outing, {
    toolName: params.proposal.tool_name,
    decision: params.decision,
    proposalId: params.proposal.id,
    decidedAt: params.decidedAt,
    note: params.note,
  });

  try {
    const existing = await getGroupOutingForUser(admin, { outingId, userId, agentId });
    if (existing) {
      await updateGroupOuting(admin, {
        outingId,
        userId,
        patch: { safety: next.safety, reservation: next.reservation, itinerary: next.itinerary },
      });
      return;
    }
  } catch (error) {
    if (!isMissingGroupTable(error)) throw error;
  }

  const agent = await getBuilderAgentRecordById(admin, agentId);
  if (!agent) return;
  await updateBuilderAgent(admin, {
    agentId: agent.id,
    userId: agent.userId,
    patch: { safetySettings: mergeGroupOutingIntoSafety(agent.safetySettings, next) },
  });
}
