import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateBuilderAgent } from "@/lib/agents/repository";
import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";
import { evaluateToolThroughControlLayer } from "@/lib/agents/runtime/control/control-layer";
import { loadedAgentFromRecord } from "@/lib/lighting-concierge/loaded-agent";
import { fetchGroupDiningTaste } from "@/lib/qloo/client";
import { executionStatusFromSafety, trackGalleryTemplateRun } from "@/lib/templates/execution-record";
import type { QlooTasteResult } from "@/lib/qloo/types";
import { missionConfigEnablesLock } from "@/lib/safety/mission";
import {
  GROUP_MISSION,
  PLAN_GROUP_ACTION,
  PLAN_GROUP_TOOL,
  REQUEST_RESERVATION_ACTION,
  REQUEST_RESERVATION_TOOL,
} from "./constants";
import type { FeedbackReason } from "./constants";
import {
  findGroupOutingByIdempotency,
  getGroupOutingForUser,
  getLatestGroupOuting,
  insertGroupOuting,
  isMissingGroupTable,
  mergeGroupOutingIntoSafety,
  updateGroupOuting,
  groupOutingsFromSafety,
} from "./repository";
import { candidatesFromQloo, pickThreeRecommendations } from "./score";
import type {
  GroupFeedback,
  GroupIntake,
  GroupItinerary,
  GroupOuting,
  GroupReservation,
  GroupSafetyRecord,
} from "./types";

function applyGroupMission(safety: BuilderAgentRecord["safetySettings"]) {
  const thresholdInr = safety.thresholdInr && safety.thresholdInr > 0 ? safety.thresholdInr : 5_000;
  let next = safety.thresholdInr === thresholdInr ? safety : { ...safety, thresholdInr };
  let changed = next !== safety;
  if (!missionConfigEnablesLock(next.mission)) {
    next = { ...next, mission: { ...GROUP_MISSION } };
    changed = true;
  }
  return { next, changed };
}

async function ensureGroupMission(
  admin: ReturnType<typeof createAdminClient>,
  agent: BuilderAgentRecord
): Promise<BuilderAgentRecord> {
  const { next, changed } = applyGroupMission(agent.safetySettings);
  if (!changed) return agent;
  await updateBuilderAgent(admin, {
    agentId: agent.id,
    userId: agent.userId,
    patch: { safetySettings: next },
  });
  agent.safetySettings = next;
  return agent;
}

function emptyQloo(): QlooTasteResult {
  return {
    source: "fallback",
    queriedAt: new Date().toISOString(),
    endpoint: "",
    tags: [],
    entities: [],
    usedSignals: [],
  };
}

function emptySafety(reason = "Draft saved."): GroupSafetyRecord {
  return {
    decision: "ALLOW",
    actionType: PLAN_GROUP_ACTION,
    toolName: PLAN_GROUP_TOOL,
    estimatedAmountInr: null,
    policyRules: [],
    reason,
    approvalStatus: "not_required",
    timestamp: new Date().toISOString(),
    executionStatus: "not_started",
  };
}

function controlToSafety(params: {
  decision: "ALLOW" | "REVIEW" | "BLOCK";
  actionType: string;
  toolName: string;
  amountInr: number | null;
  reason: string;
  matchedPolicies: Array<{ name: string; reason: string }>;
  proposalId: string | null;
}): GroupSafetyRecord {
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
    executionStatus:
      params.decision === "ALLOW" ? "executed" : params.decision === "BLOCK" ? "blocked" : "awaiting_approval",
  };
}

function outingFingerprint(intake: GroupIntake): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        groupName: intake.groupName,
        city: intake.city,
        outingDate: intake.outingDate,
        startTime: intake.startTime,
        people: intake.participants.map((person) => person.displayName),
      })
    )
    .digest("hex")
    .slice(0, 32);
}

async function persistOuting(
  admin: ReturnType<typeof createAdminClient>,
  agent: BuilderAgentRecord,
  outing: GroupOuting,
  mode: "insert" | "update"
): Promise<GroupOuting> {
  const refreshed = { ...outing, updatedAt: new Date().toISOString() };
  try {
    if (mode === "insert") return await insertGroupOuting(admin, refreshed);
    return await updateGroupOuting(admin, {
      outingId: refreshed.id,
      userId: refreshed.userId,
      patch: {
        intake: refreshed.intake,
        qloo: refreshed.qloo,
        candidates: refreshed.candidates,
        recommendations: refreshed.recommendations,
        feedback: refreshed.feedback,
        history: refreshed.history,
        itinerary: refreshed.itinerary,
        reservation: refreshed.reservation,
        tooFewReason: refreshed.tooFewReason,
        safety: refreshed.safety,
      },
    });
  } catch (error) {
    if (!isMissingGroupTable(error)) throw error;
    const safetySettings = mergeGroupOutingIntoSafety(agent.safetySettings, refreshed);
    await updateBuilderAgent(admin, {
      agentId: agent.id,
      userId: agent.userId,
      patch: { safetySettings },
    });
    agent.safetySettings = safetySettings;
    return refreshed;
  }
}

async function loadOuting(
  admin: ReturnType<typeof createAdminClient>,
  params: { outingId: string; userId: string; agent: BuilderAgentRecord }
): Promise<GroupOuting | null> {
  try {
    const fromTable = await getGroupOutingForUser(admin, {
      outingId: params.outingId,
      userId: params.userId,
      agentId: params.agent.id,
    });
    if (fromTable) return fromTable;
  } catch (error) {
    if (!isMissingGroupTable(error)) throw error;
  }
  return groupOutingsFromSafety(params.agent.safetySettings).find((item) => item.id === params.outingId) ?? null;
}

function rerank(outing: GroupOuting): GroupOuting {
  const picked = pickThreeRecommendations(outing.candidates, outing.intake, outing.feedback);
  return {
    ...outing,
    recommendations: picked.recommendations,
    tooFewReason: picked.tooFewReason,
    updatedAt: new Date().toISOString(),
  };
}

export function reservationResourceType(outing: GroupOuting): string {
  if (outing.reservation && ["pending_confirmation", "awaiting_approval"].includes(outing.reservation.status)) {
    return "duplicate_reservation";
  }
  if (!outing.itinerary) return "incomplete_reservation";
  if (outing.intake.budgetCurrency !== "INR") return "foreign_currency_reservation";
  const amount = outing.itinerary.costPerPerson != null
    ? outing.itinerary.costPerPerson * outing.intake.participants.length
    : outing.intake.maxBudgetInr;
  if (amount == null) return "incomplete_reservation";
  return "pending_confirmation";
}

export async function saveGroupOuting(params: {
  agent: BuilderAgentRecord;
  userId: string;
  intake: GroupIntake;
  outingId?: string;
}): Promise<GroupOuting> {
  const admin = createAdminClient();
  const agent = await ensureGroupMission(admin, params.agent);
  const key = outingFingerprint(params.intake);
  const existing =
    (params.outingId ? await loadOuting(admin, { outingId: params.outingId, userId: params.userId, agent }) : null) ??
    (await findGroupOutingByIdempotency(admin, { userId: params.userId, agentId: agent.id, idempotencyKey: key })) ??
    groupOutingsFromSafety(agent.safetySettings).find((item) => item.idempotencyKey === key) ??
    null;

  const outing: GroupOuting = existing
    ? {
        ...existing,
        intake: params.intake,
        updatedAt: new Date().toISOString(),
        history: [...existing.history, { at: new Date().toISOString(), summary: "Group details updated." }].slice(-40),
      }
    : {
        id: randomUUID(),
        organizationId: agent.organizationId,
        userId: params.userId,
        agentId: agent.id,
        idempotencyKey: key,
        intake: params.intake,
        qloo: emptyQloo(),
        candidates: [],
        recommendations: [],
        feedback: [],
        history: [{ at: new Date().toISOString(), summary: "Group created." }],
        itinerary: null,
        reservation: null,
        tooFewReason: null,
        safety: emptySafety(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

  return persistOuting(admin, agent, outing, existing ? "update" : "insert");
}

export async function discoverGroupRestaurants(params: {
  agent: BuilderAgentRecord;
  userId: string;
  outingId: string;
}): Promise<GroupOuting> {
  const admin = createAdminClient();
  const agent = await ensureGroupMission(admin, params.agent);
  const outing = await loadOuting(admin, { outingId: params.outingId, userId: params.userId, agent });
  if (!outing) throw new Error("Group outing not found.");

  const loaded = loadedAgentFromRecord(agent);
  const control = await evaluateToolThroughControlLayer(admin, {
    agent: loaded,
    userId: params.userId,
    organizationId: agent.organizationId,
    toolName: PLAN_GROUP_TOOL,
    actionType: PLAN_GROUP_ACTION,
    toolInput: { city: outing.intake.city, _groupOutingId: outing.id },
    source: "group_planner",
  });

  const likes = outing.intake.participants.flatMap((person) => [
    ...person.likes,
    person.preferredCuisines ?? "",
  ]);
  const qloo = await fetchGroupDiningTaste({ city: outing.intake.city, likeQueries: likes });
  const candidates = candidatesFromQloo(
    qloo.entities,
    qloo.queriedAt,
    qloo.source === "qloo" ? "qloo" : "stated_preferences"
  );
  const picked = pickThreeRecommendations(candidates, outing.intake, outing.feedback);
  const safety = controlToSafety({
    decision: control.decision,
    actionType: PLAN_GROUP_ACTION,
    toolName: PLAN_GROUP_TOOL,
    amountInr: outing.intake.maxBudgetInr,
    reason: control.reason,
    matchedPolicies: control.matchedPolicies,
    proposalId: control.proposalId,
  });

  const saved = await persistOuting(
    admin,
    agent,
    {
      ...outing,
      qloo,
      candidates,
      recommendations: picked.recommendations,
      tooFewReason: picked.tooFewReason,
      safety,
      history: [
        ...outing.history,
        {
          at: new Date().toISOString(),
          summary:
            qloo.source === "qloo"
              ? `Qloo returned ${candidates.length} place candidates.`
              : `Qloo fallback: ${qloo.error ?? "no live restaurant list"}. WAVE did not invent restaurants.`,
        },
      ].slice(-40),
    },
    "update"
  );
  trackGroupRun(admin, agent, params.userId, saved, "discover");
  return saved;
}

export async function submitGroupFeedback(params: {
  agent: BuilderAgentRecord;
  userId: string;
  outingId: string;
  participantId: string;
  restaurantId: string;
  reason: FeedbackReason;
  note?: string;
}): Promise<GroupOuting> {
  const admin = createAdminClient();
  const agent = await ensureGroupMission(admin, params.agent);
  const outing = await loadOuting(admin, { outingId: params.outingId, userId: params.userId, agent });
  if (!outing) throw new Error("Group outing not found.");
  const person = outing.intake.participants.find((item) => item.id === params.participantId);
  if (!person) throw new Error("That participant is not on this outing.");
  const restaurant = outing.candidates.find((item) => item.id === params.restaurantId);
  if (!restaurant) throw new Error("That restaurant is not in the current candidate list.");

  const feedback: GroupFeedback = {
    id: randomUUID(),
    participantId: person.id,
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    reason: params.reason,
    note: params.note,
    createdAt: new Date().toISOString(),
  };
  const next = rerank({
    ...outing,
    feedback: [...outing.feedback, feedback],
    history: [
      ...outing.history,
      {
        at: feedback.createdAt,
        summary: `${person.displayName} marked ${restaurant.name} as not for them (${params.reason}). Rankings were recomputed on the server.`,
      },
    ].slice(-40),
  });
  const saved = await persistOuting(admin, agent, next, "update");
  trackGroupRun(admin, agent, params.userId, saved, "feedback");
  return saved;
}

export async function undoGroupFeedback(params: {
  agent: BuilderAgentRecord;
  userId: string;
  outingId: string;
  feedbackId: string;
}): Promise<GroupOuting> {
  const admin = createAdminClient();
  const agent = await ensureGroupMission(admin, params.agent);
  const outing = await loadOuting(admin, { outingId: params.outingId, userId: params.userId, agent });
  if (!outing) throw new Error("Group outing not found.");
  const next = rerank({
    ...outing,
    feedback: outing.feedback.map((item) => (item.id === params.feedbackId ? { ...item, undone: true } : item)),
    history: [...outing.history, { at: new Date().toISOString(), summary: "A Not for me vote was undone and rankings were recomputed." }].slice(-40),
  });
  return persistOuting(admin, agent, next, "update");
}

export async function selectGroupRestaurant(params: {
  agent: BuilderAgentRecord;
  userId: string;
  outingId: string;
  restaurantId: string;
}): Promise<GroupOuting> {
  const admin = createAdminClient();
  const agent = await ensureGroupMission(admin, params.agent);
  const outing = await loadOuting(admin, { outingId: params.outingId, userId: params.userId, agent });
  if (!outing) throw new Error("Group outing not found.");
  const picked = outing.recommendations.find((item) => item.scored.candidate.id === params.restaurantId);
  const restaurant = picked?.scored.candidate ?? outing.candidates.find((item) => item.id === params.restaurantId);
  if (!restaurant) throw new Error("Select one of the current recommendations.");

  const unresolved = [
    ...(restaurant.unknownFields ?? []),
    "No booking provider is connected, so the table is not reserved.",
  ];
  const itinerary: GroupItinerary = {
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    date: outing.intake.outingDate,
    startTime: outing.intake.startTime,
    endTime: outing.intake.endTime,
    estimatedDurationMinutes: 120,
    meetingArea: restaurant.neighborhood ?? outing.intake.city,
    costPerPerson: restaurant.estimatedCostPerPerson ?? null,
    confirmations: [],
    reservationStatus: "not_requested",
    unresolved,
  };
  return persistOuting(
    admin,
    agent,
    {
      ...outing,
      itinerary,
      history: [...outing.history, { at: new Date().toISOString(), summary: `Selected ${restaurant.name} for the outing plan.` }].slice(-40),
    },
    "update"
  );
}

export async function requestGroupReservation(params: {
  agent: BuilderAgentRecord;
  userId: string;
  outingId: string;
}): Promise<GroupOuting> {
  const admin = createAdminClient();
  const agent = await ensureGroupMission(admin, params.agent);
  const outing = await loadOuting(admin, { outingId: params.outingId, userId: params.userId, agent });
  if (!outing) throw new Error("Group outing not found.");
  if (!outing.itinerary) throw new Error("Select a restaurant before requesting a reservation.");

  const resourceType = reservationResourceType(outing);
  const amount = outing.itinerary.costPerPerson != null
    ? outing.itinerary.costPerPerson * outing.intake.participants.length
    : outing.intake.maxBudgetInr;
  const amountPaise = Math.round(amount * 100);
  const loaded = loadedAgentFromRecord(agent);
  const control = await evaluateToolThroughControlLayer(admin, {
    agent: loaded,
    userId: params.userId,
    organizationId: agent.organizationId,
    toolName: REQUEST_RESERVATION_TOOL,
    actionType: REQUEST_RESERVATION_ACTION,
    toolInput: {
      amount: amountPaise,
      currency: outing.intake.budgetCurrency,
      resourceType,
      _groupOutingId: outing.id,
    },
    source: "group_planner",
  });
  const safety = controlToSafety({
    decision: control.decision,
    actionType: REQUEST_RESERVATION_ACTION,
    toolName: REQUEST_RESERVATION_TOOL,
    amountInr: outing.intake.budgetCurrency === "INR" ? amount : null,
    reason: control.reason,
    matchedPolicies: control.matchedPolicies,
    proposalId: control.proposalId,
  });
  const reservation: GroupReservation = {
    id: randomUUID(),
    restaurantId: outing.itinerary.restaurantId,
    restaurantName: outing.itinerary.restaurantName,
    amount,
    currency: outing.intake.budgetCurrency,
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
        : "No restaurant booking provider is connected. This is a pending confirmation request, not a reserved table.",
    proposalId: control.proposalId,
    idempotencyKey: createHash("sha256").update(`${outing.id}:${outing.itinerary.restaurantId}`).digest("hex"),
    createdAt: new Date().toISOString(),
  };
  const saved = await persistOuting(
    admin,
    agent,
    {
      ...outing,
      safety,
      reservation,
      itinerary: { ...outing.itinerary, reservationStatus: reservation.status },
      history: [...outing.history, { at: reservation.createdAt, summary: `Reservation request ${reservation.status}.` }].slice(-40),
    },
    "update"
  );
  trackGroupRun(admin, agent, params.userId, saved, "reserve");
  return saved;
}

function trackGroupRun(
  admin: ReturnType<typeof createAdminClient>,
  agent: BuilderAgentRecord,
  userId: string,
  outing: GroupOuting,
  kind: "discover" | "feedback" | "reserve"
): void {
  const status = outing.tooFewReason && kind === "discover" && outing.recommendations.length === 0
    ? "failed"
    : executionStatusFromSafety(outing.safety.decision);
  trackGalleryTemplateRun({
    admin,
    agent,
    userId,
    templateSlug: "group-decision-planner",
    idempotencyKey: `group:${kind}:${outing.id}:${outing.recommendations.map((item) => item.scored.candidate.id).join(",")}:${outing.feedback.length}`,
    inputSummary:
      kind === "reserve"
        ? `Reservation ${outing.reservation?.status ?? "none"} at ${outing.itinerary?.restaurantName ?? "unselected"}.`
        : outing.recommendations.length
          ? `Ranked ${outing.recommendations.length} restaurant option(s) in ${outing.intake.city}.`
          : outing.tooFewReason ?? "Not enough valid restaurant candidates.",
    resultPayload: {
      outingId: outing.id,
      recommendations: outing.recommendations,
      tooFewReason: outing.tooFewReason,
      qlooSource: outing.qloo.source,
      reservation: outing.reservation
        ? { id: outing.reservation.id, status: outing.reservation.status }
        : null,
    },
    executionStatus: status,
    safetyDecision: outing.safety.decision,
    approvalState: outing.safety.approvalStatus,
    errorMessage: status === "failed" ? outing.tooFewReason : null,
    sources: [outing.qloo.source === "qloo" ? "qloo" : "stated_preferences"],
  });
}

export async function loadGroupWorkspace(
  supabase: SupabaseClient,
  params: { userId: string; agent: BuilderAgentRecord }
): Promise<{ outing: GroupOuting | null; reservationThresholdInr: number }> {
  const admin = createAdminClient();
  const agent = await ensureGroupMission(admin, params.agent);
  const outing =
    (await getLatestGroupOuting(supabase, { userId: params.userId, agentId: agent.id })) ??
    groupOutingsFromSafety(agent.safetySettings)[0] ??
    null;
  return {
    outing,
    reservationThresholdInr: agent.safetySettings.groupPlanner?.reservationThresholdInr ?? agent.safetySettings.thresholdInr ?? 5000,
  };
}

export async function saveGroupSettings(params: {
  agent: BuilderAgentRecord;
  reservationThresholdInr: number;
}): Promise<number> {
  const admin = createAdminClient();
  const safetySettings = {
    ...params.agent.safetySettings,
    thresholdInr: params.reservationThresholdInr,
    groupPlanner: {
      ...params.agent.safetySettings.groupPlanner,
      reservationThresholdInr: params.reservationThresholdInr,
    },
  };
  await updateBuilderAgent(admin, {
    agentId: params.agent.id,
    userId: params.agent.userId,
    patch: { safetySettings, suggestedThreshold: params.reservationThresholdInr },
  });
  return params.reservationThresholdInr;
}
