import type { SupabaseClient } from "@supabase/supabase-js";
import { getBuilderAgentRecordById, updateBuilderAgent } from "@/lib/agents/repository";
import type { ActionProposalRow } from "@/lib/gateway/proposals/repository";
import { PLAN_WEDDING_TOOL, REQUEST_DEPOSIT_TOOL } from "./constants";
import {
  getWeddingEventForUser,
  isMissingWeddingTable,
  mergeWeddingEventIntoSafety,
  updateWeddingEvent,
  weddingEventsFromSafety,
} from "./repository";
import type { WeddingEvent } from "./types";

export function weddingDecisionIsAuthorized(eventUserId: string, claimedUserId: string): boolean {
  return eventUserId === claimedUserId;
}

export function isWeddingPlannerProposal(row: {
  tool_name?: string;
  action_payload?: Record<string, unknown>;
}): boolean {
  if (row.tool_name === PLAN_WEDDING_TOOL || row.tool_name === REQUEST_DEPOSIT_TOOL) return true;
  return Boolean(row.action_payload?._weddingEventId);
}

export function applyWeddingDecisionToEvent(
  event: WeddingEvent,
  params: { toolName: string; decision: "approved" | "rejected"; proposalId: string; decidedAt: string; note?: string }
): WeddingEvent {
  const approved = params.decision === "approved";
  const safety: WeddingEvent["safety"] = {
    ...event.safety,
    approvalStatus: approved ? "approved" : "rejected",
    executionStatus: approved ? "executed" : "rejected",
    timestamp: params.decidedAt,
    proposalId: params.proposalId,
  };
  if (params.toolName !== REQUEST_DEPOSIT_TOOL) {
    return { ...event, safety, updatedAt: params.decidedAt };
  }
  return {
    ...event,
    updatedAt: params.decidedAt,
    safety,
    deposits: event.deposits.map((deposit) => {
      if (deposit.proposalId !== params.proposalId) return deposit;
      const vendor = event.vendors.find((item) => item.id === deposit.vendorId);
      const quoteChanged = Boolean(vendor && vendor.quoteFingerprint !== deposit.quoteFingerprint);
      if (approved && quoteChanged) {
        return {
          ...deposit,
          status: "awaiting_approval",
          note: "The quotation changed after this request. WAVE did not mark it paid. Request a new deposit for a fresh safety check.",
          reference: null,
        };
      }
      return {
        ...deposit,
        status: approved ? "approved_awaiting_payment" : "rejected",
        note: approved
          ? "Approved as a pending payment request. WAVE has no vendor payout provider, so this is not paid."
          : params.note ?? "Deposit request rejected.",
        reference: null,
      };
    }),
  };
}

export async function applyWeddingProposalDecision(
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
  const eventId = typeof payload._weddingEventId === "string" ? payload._weddingEventId : null;
  const userId =
    typeof payload._zeltaRuntimeUserId === "string" ? payload._zeltaRuntimeUserId : params.actorId;
  const agentId =
    typeof payload._zeltaBuilderAgentId === "string" ? payload._zeltaBuilderAgentId : null;
  if (!eventId || !agentId) return;

  const event =
    (await getWeddingEventForUser(admin, { eventId, userId, agentId })) ??
    weddingEventsFromSafety((await getBuilderAgentRecordById(admin, agentId))?.safetySettings)?.find(
      (item) => item.id === eventId
    ) ??
    null;
  if (!event) return;
  if (!weddingDecisionIsAuthorized(event.userId, userId)) return;

  const next = applyWeddingDecisionToEvent(event, {
    toolName: params.proposal.tool_name,
    decision: params.decision,
    proposalId: params.proposal.id,
    decidedAt: params.decidedAt,
    note: params.note,
  });

  try {
    const existing = await getWeddingEventForUser(admin, { eventId, userId, agentId });
    if (existing) {
      await updateWeddingEvent(admin, {
        eventId,
        userId,
        patch: { safety: next.safety, deposits: next.deposits },
      });
      return;
    }
  } catch (error) {
    if (!isMissingWeddingTable(error)) throw error;
  }

  const agent = await getBuilderAgentRecordById(admin, agentId);
  if (!agent) return;
  await updateBuilderAgent(admin, {
    agentId: agent.id,
    userId: agent.userId,
    patch: { safetySettings: mergeWeddingEventIntoSafety(agent.safetySettings, next) },
  });
}
