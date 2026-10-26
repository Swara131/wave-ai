import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateBuilderAgent } from "@/lib/agents/repository";
import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";
import { evaluateToolThroughControlLayer } from "@/lib/agents/runtime/control/control-layer";
import { fetchTravelTaste } from "@/lib/qloo/client";
import { executionStatusFromSafety, trackGalleryTemplateRun } from "@/lib/templates/execution-record";
import { loadedAgentFromRecord } from "@/lib/lighting-concierge/loaded-agent";
import { missionConfigEnablesLock } from "@/lib/safety/mission";
import {
  PLAN_ITINERARY_ACTION,
  PLAN_ITINERARY_TOOL,
  REQUEST_BOOKING_ACTION,
  REQUEST_BOOKING_TOOL,
  TRAVEL_MISSION,
} from "./constants";
import {
  activitiesOverlap,
  buildTravelItinerary,
  findActivity,
  itineraryFingerprint,
  regenerateDay,
  removeActivity,
  replaceActivity,
} from "./itinerary";
import {
  findTravelTripByIdempotency,
  getLatestTravelTrip,
  getTravelTripForUser,
  insertTravelTrip,
  isMissingTravelTable,
  mergeTravelTripIntoSafety,
  travelTripsFromSafety,
  updateTravelTrip,
} from "./repository";
import type { TravelBooking, TravelIntake, TravelSafetyRecord, TravelTrip } from "./types";

function applyTravelMission(safety: BuilderAgentRecord["safetySettings"]) {
  const thresholdInr = safety.thresholdInr && safety.thresholdInr > 0 ? safety.thresholdInr : 5000;
  let next = safety.thresholdInr === thresholdInr ? safety : { ...safety, thresholdInr };
  let changed = next !== safety;
  if (!missionConfigEnablesLock(next.mission)) {
    next = { ...next, mission: { ...TRAVEL_MISSION } };
    changed = true;
  }
  return { next, changed };
}

async function ensureTravelMission(
  admin: ReturnType<typeof createAdminClient>,
  agent: BuilderAgentRecord
): Promise<BuilderAgentRecord> {
  const { next, changed } = applyTravelMission(agent.safetySettings);
  if (!changed) return agent;
  await updateBuilderAgent(admin, {
    agentId: agent.id,
    userId: agent.userId,
    patch: { safetySettings: next },
  });
  agent.safetySettings = next;
  return agent;
}

async function persistTrip(
  admin: ReturnType<typeof createAdminClient>,
  agent: BuilderAgentRecord,
  trip: TravelTrip,
  mode: "insert" | "update"
): Promise<TravelTrip> {
  try {
    if (mode === "insert") return await insertTravelTrip(admin, trip);
    return await updateTravelTrip(admin, {
      tripId: trip.id,
      userId: agent.userId,
      patch: { itinerary: trip.itinerary, safety: trip.safety, bookings: trip.bookings, qloo: trip.qloo },
    });
  } catch (error) {
    if (!isMissingTravelTable(error)) throw error;
    const safetySettings = mergeTravelTripIntoSafety(agent.safetySettings, trip);
    await updateBuilderAgent(admin, {
      agentId: agent.id,
      userId: agent.userId,
      patch: { safetySettings },
    });
    agent.safetySettings = safetySettings;
    return trip;
  }
}

async function loadTrip(
  admin: ReturnType<typeof createAdminClient>,
  params: { tripId: string; userId: string; agent: BuilderAgentRecord }
): Promise<TravelTrip | null> {
  return (
    (await getTravelTripForUser(admin, {
      tripId: params.tripId,
      userId: params.userId,
      agentId: params.agent.id,
    })) ?? travelTripsFromSafety(params.agent.safetySettings).find((item) => item.id === params.tripId) ?? null
  );
}

function controlToSafety(params: {
  decision: "ALLOW" | "REVIEW" | "BLOCK";
  actionType: string;
  toolName: string;
  amountInr: number | null;
  reason: string;
  matchedPolicies: Array<{ name: string; reason: string }>;
  proposalId: string | null;
}): TravelSafetyRecord {
  const passThrough = new Set([
    "No explicit mission lock configured.",
    "Action is within the agent mission scope.",
  ]);
  const policyReason = params.matchedPolicies[0]?.reason?.trim();
  const reason = policyReason && passThrough.has(params.reason) ? policyReason : params.reason;
  return {
    decision: params.decision,
    actionType: params.actionType,
    toolName: params.toolName,
    estimatedAmountInr: params.amountInr,
    policyRules: params.matchedPolicies.map((policy) => policy.name),
    reason,
    approvalStatus: params.decision === "ALLOW" ? "not_required" : params.decision === "BLOCK" ? "blocked" : "pending",
    proposalId: params.proposalId,
    timestamp: new Date().toISOString(),
    executionStatus: params.decision === "ALLOW" ? "executed" : params.decision === "BLOCK" ? "blocked" : "awaiting_approval",
  };
}

function bookingResourceType(params: {
  intake: TravelIntake;
  activityCost: number | null;
  overlap: boolean;
  tripDays: number;
}): string {
  if (params.overlap) return "overlapping_booking";
  if (params.intake.budgetCurrency !== "INR") return "foreign_currency_booking";
  if (params.activityCost == null) return "incomplete_booking";
  if (params.tripDays > 1) return "multiday_booking";
  return "pending_request";
}

export function existingOpenBooking(bookings: TravelBooking[], activityId: string): TravelBooking | undefined {
  return bookings.find(
    (booking) => booking.activityId === activityId && booking.status !== "rejected" && booking.status !== "blocked"
  );
}

export async function planTravelTrip(params: {
  agent: BuilderAgentRecord;
  userId: string;
  intake: TravelIntake;
  replanTripId?: string;
}): Promise<TravelTrip> {
  const admin = createAdminClient();
  const agent = await ensureTravelMission(admin, params.agent);
  const loaded = loadedAgentFromRecord(agent);
  const idempotencyKey = itineraryFingerprint(params.intake);
  if (!params.replanTripId) {
    const existing =
      (await findTravelTripByIdempotency(admin, {
        userId: params.userId,
        agentId: agent.id,
        idempotencyKey,
      })) ??       travelTripsFromSafety(agent.safetySettings).find((item) => item.idempotencyKey === idempotencyKey);
    if (existing) {
      trackTravelRun(admin, agent, params.userId, existing, "plan");
      return existing;
    }
  }

  const qloo = await fetchTravelTaste({
    destination: params.intake.destination,
    interests: params.intake.interests,
    extraQueries: [
      params.intake.favoriteCuisines ?? "",
      params.intake.culturalInterests ?? "",
      `${params.intake.destination} travel`,
    ],
  });
  const itinerary = buildTravelItinerary(params.intake, qloo);
  const tripId = params.replanTripId ?? randomUUID();
  const control = await evaluateToolThroughControlLayer(admin, {
    agent: loaded,
    userId: params.userId,
    organizationId: agent.organizationId,
    toolName: PLAN_ITINERARY_TOOL,
    actionType: PLAN_ITINERARY_ACTION,
    toolInput: {
      destination: params.intake.destination,
      startDate: params.intake.startDate,
      endDate: params.intake.endDate,
      _travelTripId: tripId,
    },
    source: "travel_companion",
  });

  if (params.replanTripId) {
    const existingTrip = await loadTrip(admin, { tripId: params.replanTripId, userId: params.userId, agent });
    if (!existingTrip) throw new Error("Travel trip not found.");
    const replanned = await persistTrip(
      admin,
      agent,
      {
        ...existingTrip,
        intake: params.intake,
        itinerary,
        qloo,
        safety: controlToSafety({
          decision: control.decision,
          actionType: PLAN_ITINERARY_ACTION,
          toolName: PLAN_ITINERARY_TOOL,
          amountInr: params.intake.budgetCurrency === "INR" ? params.intake.budgetAmount : null,
          reason: control.reason,
          matchedPolicies: control.matchedPolicies,
          proposalId: control.proposalId,
        }),
        updatedAt: new Date().toISOString(),
      },
      "update"
    );
    trackTravelRun(admin, agent, params.userId, replanned, "plan");
    return replanned;
  }

  const created: TravelTrip = {
    id: tripId,
    organizationId: agent.organizationId,
    userId: params.userId,
    agentId: agent.id,
    idempotencyKey,
    intake: params.intake,
    itinerary,
    qloo,
    safety: controlToSafety({
      decision: control.decision,
      actionType: PLAN_ITINERARY_ACTION,
      toolName: PLAN_ITINERARY_TOOL,
      amountInr: params.intake.budgetCurrency === "INR" ? params.intake.budgetAmount : null,
      reason: control.reason,
      matchedPolicies: control.matchedPolicies,
      proposalId: control.proposalId,
    }),
    bookings: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const saved = await persistTrip(admin, agent, created, "insert");
  trackTravelRun(admin, agent, params.userId, saved, "plan");
  return saved;
}

export async function mutateTravelTrip(params: {
  agent: BuilderAgentRecord;
  userId: string;
  tripId: string;
  action: "remove" | "replace" | "regenerate_day";
  activityId?: string;
  dayIndex?: number;
}): Promise<TravelTrip> {
  const admin = createAdminClient();
  const agent = await ensureTravelMission(admin, params.agent);
  const trip = await loadTrip(admin, { tripId: params.tripId, userId: params.userId, agent });
  if (!trip) throw new Error("Travel trip not found.");
  let itinerary = trip.itinerary;
  if (params.action === "remove") {
    if (!params.activityId) throw new Error("Select an activity to remove.");
    itinerary = removeActivity(trip.itinerary, params.activityId);
  } else if (params.action === "replace") {
    if (!params.activityId) throw new Error("Select an activity to replace.");
    itinerary = replaceActivity(trip.itinerary, params.activityId, trip.intake, trip.qloo);
  } else {
    itinerary = regenerateDay(trip.itinerary, params.dayIndex ?? 0, trip.intake, trip.qloo);
  }
  return persistTrip(
    admin,
    agent,
    { ...trip, itinerary, updatedAt: new Date().toISOString() },
    "update"
  );
}

export async function requestTravelBooking(params: {
  agent: BuilderAgentRecord;
  userId: string;
  tripId: string;
  activityId: string;
  partySize: number;
}): Promise<TravelTrip> {
  const admin = createAdminClient();
  const agent = await ensureTravelMission(admin, params.agent);
  const trip = await loadTrip(admin, { tripId: params.tripId, userId: params.userId, agent });
  if (!trip) throw new Error("Travel trip not found.");
  const activity = findActivity(trip.itinerary, params.activityId);
  if (!activity) throw new Error("That activity is no longer on the itinerary.");

  const duplicate = existingOpenBooking(trip.bookings, activity.id);
  if (duplicate) {
    trackTravelRun(admin, agent, params.userId, trip, "booking");
    return trip;
  }

  const overlap = trip.bookings.some(
    (booking) =>
      booking.status !== "rejected" &&
      booking.status !== "blocked" &&
      activitiesOverlap(
        activity,
        {
          ...activity,
          id: booking.activityId,
          dayDate: booking.date,
          startTime: booking.startTime,
          endTime: booking.endTime,
        }
      )
  );

  const tripDays = trip.itinerary.days.length;
  const resourceType = bookingResourceType({
    intake: trip.intake,
    activityCost: activity.estimatedCostPerPerson,
    overlap,
    tripDays,
  });
  const amount = activity.estimatedCostPerPerson == null ? 0 : Math.round(activity.estimatedCostPerPerson * params.partySize * 100);
  const idempotencyKey = createHash("sha256").update(`${trip.id}:${activity.id}`).digest("hex");

  const loaded = loadedAgentFromRecord(agent);
  const control = await evaluateToolThroughControlLayer(admin, {
    agent: loaded,
    userId: params.userId,
    organizationId: agent.organizationId,
    toolName: REQUEST_BOOKING_TOOL,
    actionType: REQUEST_BOOKING_ACTION,
    toolInput: {
      amount,
      currency: trip.intake.budgetCurrency,
      resourceType,
      activityId: activity.id,
      date: activity.dayDate,
      startTime: activity.startTime,
      endTime: activity.endTime,
      partySize: params.partySize,
      _travelTripId: trip.id,
    },
    source: "travel_companion",
  });

  const safety = controlToSafety({
    decision: control.decision,
    actionType: REQUEST_BOOKING_ACTION,
    toolName: REQUEST_BOOKING_TOOL,
    amountInr: activity.estimatedCostPerPerson,
    reason: control.reason,
    matchedPolicies: control.matchedPolicies,
    proposalId: control.proposalId,
  });

  const booking: TravelBooking = {
    id: randomUUID(),
    activityId: activity.id,
    title: activity.title,
    date: activity.dayDate,
    startTime: activity.startTime,
    endTime: activity.endTime,
    partySize: params.partySize,
    amount: activity.estimatedCostPerPerson,
    currency: trip.intake.budgetCurrency,
    status:
      control.decision === "ALLOW"
        ? "pending_confirmation"
        : control.decision === "BLOCK"
          ? "blocked"
          : "awaiting_approval",
    provider: "none",
    reference: null,
    note:
      control.decision === "BLOCK"
        ? safety.reason
        : "No reservation or ticket provider is connected. This is a pending request, not a confirmed booking.",
    proposalId: control.proposalId,
    idempotencyKey,
    createdAt: new Date().toISOString(),
  };

  const saved = await persistTrip(
    admin,
    agent,
    {
      ...trip,
      safety,
      bookings: [...trip.bookings, booking],
      updatedAt: new Date().toISOString(),
    },
    "update"
  );
  trackTravelRun(admin, agent, params.userId, saved, "booking");
  return saved;
}

function trackTravelRun(
  admin: ReturnType<typeof createAdminClient>,
  agent: BuilderAgentRecord,
  userId: string,
  trip: TravelTrip,
  kind: "plan" | "booking"
): void {
  trackGalleryTemplateRun({
    admin,
    agent,
    userId,
    templateSlug: "travel-companion",
    idempotencyKey: `travel:${kind}:${trip.idempotencyKey}:${trip.bookings.length}`,
    inputSummary:
      kind === "booking"
        ? `Booking request for ${trip.intake.destination}. Latest status ${trip.bookings[trip.bookings.length - 1]?.status ?? "none"}.`
        : `${trip.itinerary.days.length}-day itinerary for ${trip.intake.destination}. Prices and hours unverified.`,
    resultPayload: {
      tripId: trip.id,
      itinerary: trip.itinerary,
      qlooSource: trip.qloo.source,
      bookings: trip.bookings.map((item) => ({
        id: item.id,
        status: item.status,
        title: item.title,
      })),
    },
    executionStatus: executionStatusFromSafety(trip.safety.decision),
    safetyDecision: trip.safety.decision,
    approvalState: trip.safety.approvalStatus,
    sources: [trip.qloo.source === "qloo" ? "qloo" : "stated_preferences"],
  });
}

export async function loadTravelWorkspace(
  supabase: SupabaseClient,
  params: { userId: string; agent: BuilderAgentRecord }
): Promise<{ trip: TravelTrip | null; bookingThresholdInr: number }> {
  const admin = createAdminClient();
  const agent = await ensureTravelMission(admin, params.agent);
  return {
    bookingThresholdInr: agent.safetySettings.thresholdInr && agent.safetySettings.thresholdInr > 0
      ? agent.safetySettings.thresholdInr
      : 5000,
    trip:
      (await getLatestTravelTrip(supabase, { userId: params.userId, agentId: agent.id })) ??
      travelTripsFromSafety(agent.safetySettings)[0] ??
      null,
  };
}

export async function saveTravelSettings(params: {
  agent: BuilderAgentRecord;
  bookingThresholdInr: number;
}): Promise<number> {
  const admin = createAdminClient();
  const safetySettings = {
    ...params.agent.safetySettings,
    thresholdInr: params.bookingThresholdInr,
    travelCompanion: {
      ...params.agent.safetySettings.travelCompanion,
      bookingThresholdInr: params.bookingThresholdInr,
    },
  };
  await updateBuilderAgent(admin, {
    agentId: params.agent.id,
    userId: params.agent.userId,
    patch: { safetySettings, suggestedThreshold: params.bookingThresholdInr },
  });
  return params.bookingThresholdInr;
}
