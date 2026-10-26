import type { SupabaseClient } from "@supabase/supabase-js";
import { getBuilderAgentRecordById, updateBuilderAgent } from "@/lib/agents/repository";
import type { ActionProposalRow } from "@/lib/gateway/proposals/repository";
import { PLAN_ITINERARY_TOOL, REQUEST_BOOKING_TOOL } from "./constants";
import {
  getTravelTripForUser,
  isMissingTravelTable,
  mergeTravelTripIntoSafety,
  travelTripsFromSafety,
  updateTravelTrip,
} from "./repository";
import type { TravelTrip } from "./types";

export function isTravelCompanionProposal(row: {
  tool_name?: string;
  action_payload?: Record<string, unknown>;
}): boolean {
  if (row.tool_name === PLAN_ITINERARY_TOOL || row.tool_name === REQUEST_BOOKING_TOOL) return true;
  return Boolean(row.action_payload?._travelTripId);
}

export function applyTravelDecisionToTrip(
  trip: TravelTrip,
  params: { toolName: string; decision: "approved" | "rejected"; proposalId: string; decidedAt: string; note?: string }
): TravelTrip {
  const approved = params.decision === "approved";
  const safety: TravelTrip["safety"] = {
    ...trip.safety,
    approvalStatus: approved ? "approved" : "rejected",
    executionStatus: approved ? "executed" : "rejected",
    timestamp: params.decidedAt,
    proposalId: params.proposalId,
  };
  if (params.toolName !== REQUEST_BOOKING_TOOL) {
    return { ...trip, safety, updatedAt: params.decidedAt };
  }
  return {
    ...trip,
    updatedAt: params.decidedAt,
    safety,
    bookings: trip.bookings.map((booking) =>
      booking.proposalId === params.proposalId
        ? {
            ...booking,
            status: approved ? "pending_confirmation" : "rejected",
            note: approved
              ? "Approved as a pending request. WAVE still has no booking provider, so this is not a reservation."
              : params.note ?? "Booking request rejected.",
          }
        : booking
    ),
  };
}

export async function applyTravelProposalDecision(
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
  const tripId = typeof payload._travelTripId === "string" ? payload._travelTripId : null;
  const userId =
    typeof payload._zeltaRuntimeUserId === "string" ? payload._zeltaRuntimeUserId : params.actorId;
  const agentId =
    typeof payload._zeltaBuilderAgentId === "string" ? payload._zeltaBuilderAgentId : null;
  if (!tripId || !agentId) return;

  const trip =
    (await getTravelTripForUser(admin, { tripId, userId, agentId })) ??
    travelTripsFromSafety((await getBuilderAgentRecordById(admin, agentId))?.safetySettings)?.find((item) => item.id === tripId) ??
    null;
  if (!trip) return;

  const next = applyTravelDecisionToTrip(trip, {
    toolName: params.proposal.tool_name,
    decision: params.decision,
    proposalId: params.proposal.id,
    decidedAt: params.decidedAt,
    note: params.note,
  });

  try {
    const existing = await getTravelTripForUser(admin, { tripId, userId, agentId });
    if (existing) {
      await updateTravelTrip(admin, {
        tripId,
        userId,
        patch: { safety: next.safety, bookings: next.bookings, itinerary: next.itinerary },
      });
      return;
    }
  } catch (error) {
    if (!isMissingTravelTable(error)) throw error;
  }

  const agent = await getBuilderAgentRecordById(admin, agentId);
  if (!agent) return;
  await updateBuilderAgent(admin, {
    agentId: agent.id,
    userId: agent.userId,
    patch: { safetySettings: mergeTravelTripIntoSafety(agent.safetySettings, next) },
  });
}
