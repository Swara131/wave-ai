import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateBuilderAgent } from "@/lib/agents/repository";
import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";
import { evaluateToolThroughControlLayer } from "@/lib/agents/runtime/control/control-layer";
import { loadedAgentFromRecord } from "@/lib/lighting-concierge/loaded-agent";
import { executionStatusFromSafety, trackGalleryTemplateRun } from "@/lib/templates/execution-record";
import { missionConfigEnablesLock } from "@/lib/safety/mission";
import {
  PLAN_WEDDING_ACTION,
  PLAN_WEDDING_TOOL,
  REQUEST_DEPOSIT_ACTION,
  REQUEST_DEPOSIT_TOOL,
  WEDDING_MISSION,
} from "./constants";
import type { InviteTone } from "./constants";
import {
  buildBudget,
  buildWeddingPlan,
  compareVendors,
  draftInvitation,
  eventFingerprint,
  findScheduleConflicts,
  vendorQuoteFingerprint,
} from "./plan";
import {
  findWeddingEventByIdempotency,
  getLatestWeddingEvent,
  getWeddingEventForUser,
  insertWeddingEvent,
  isMissingWeddingTable,
  mergeWeddingEventIntoSafety,
  updateWeddingEvent,
  weddingEventsFromSafety,
} from "./repository";
import type {
  WeddingDeposit,
  WeddingEvent,
  WeddingIntake,
  WeddingSafetyRecord,
  WeddingTask,
  WeddingVendor,
} from "./types";

function applyWeddingMission(safety: BuilderAgentRecord["safetySettings"]) {
  const thresholdInr = safety.thresholdInr && safety.thresholdInr > 0 ? safety.thresholdInr : 10_000;
  let next = safety.thresholdInr === thresholdInr ? safety : { ...safety, thresholdInr };
  let changed = next !== safety;
  if (!missionConfigEnablesLock(next.mission)) {
    next = { ...next, mission: { ...WEDDING_MISSION } };
    changed = true;
  }
  return { next, changed };
}

async function ensureWeddingMission(
  admin: ReturnType<typeof createAdminClient>,
  agent: BuilderAgentRecord
): Promise<BuilderAgentRecord> {
  const { next, changed } = applyWeddingMission(agent.safetySettings);
  if (!changed) return agent;
  await updateBuilderAgent(admin, {
    agentId: agent.id,
    userId: agent.userId,
    patch: { safetySettings: next },
  });
  agent.safetySettings = next;
  return agent;
}

async function persistEvent(
  admin: ReturnType<typeof createAdminClient>,
  agent: BuilderAgentRecord,
  event: WeddingEvent,
  mode: "insert" | "update"
): Promise<WeddingEvent> {
  const refreshed = {
    ...event,
    budget: buildBudget({ intake: event.intake, vendors: event.vendors, deposits: event.deposits }),
    conflicts: findScheduleConflicts(event.tasks),
    updatedAt: new Date().toISOString(),
  };
  try {
    if (mode === "insert") return await insertWeddingEvent(admin, refreshed);
    return await updateWeddingEvent(admin, {
      eventId: refreshed.id,
      userId: agent.userId,
      patch: {
        intake: refreshed.intake,
        plan: refreshed.plan,
        vendors: refreshed.vendors,
        tasks: refreshed.tasks,
        invitation: refreshed.invitation,
        deposits: refreshed.deposits,
        budget: refreshed.budget,
        conflicts: refreshed.conflicts,
        safety: refreshed.safety,
      },
    });
  } catch (error) {
    if (!isMissingWeddingTable(error)) throw error;
    const safetySettings = mergeWeddingEventIntoSafety(agent.safetySettings, refreshed);
    await updateBuilderAgent(admin, {
      agentId: agent.id,
      userId: agent.userId,
      patch: { safetySettings },
    });
    agent.safetySettings = safetySettings;
    return refreshed;
  }
}

async function loadEvent(
  admin: ReturnType<typeof createAdminClient>,
  params: { eventId: string; userId: string; agent: BuilderAgentRecord }
): Promise<WeddingEvent | null> {
  return (
    (await getWeddingEventForUser(admin, {
      eventId: params.eventId,
      userId: params.userId,
      agentId: params.agent.id,
    })) ?? weddingEventsFromSafety(params.agent.safetySettings).find((item) => item.id === params.eventId) ?? null
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
  allowlistStatus?: string;
  quoteVerified?: boolean;
  recipientVerified?: boolean;
}): WeddingSafetyRecord {
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
    allowlistStatus: params.allowlistStatus,
    quoteVerified: params.quoteVerified,
    recipientVerified: params.recipientVerified,
  };
}

function emptySafety(): WeddingSafetyRecord {
  return {
    decision: "ALLOW",
    actionType: PLAN_WEDDING_ACTION,
    toolName: PLAN_WEDDING_TOOL,
    estimatedAmountInr: null,
    policyRules: [],
    reason: "Draft saved.",
    approvalStatus: "not_required",
    timestamp: new Date().toISOString(),
    executionStatus: "not_started",
  };
}

export function existingOpenDeposit(
  deposits: WeddingDeposit[],
  vendorId: string,
  amount: number,
  quoteFingerprint?: string
): WeddingDeposit | undefined {
  return deposits.find(
    (deposit) =>
      deposit.vendorId === vendorId &&
      deposit.amount === amount &&
      (quoteFingerprint == null || deposit.quoteFingerprint === quoteFingerprint) &&
      deposit.status !== "rejected" &&
      deposit.status !== "blocked"
  );
}

export function depositResourceType(params: {
  vendor: WeddingVendor;
  amount: number;
  currency: string;
  recipientId: string;
  previousQuoteFingerprint?: string | null;
}): string {
  if (params.vendor.allowlistStatus !== "approved") return "unapproved_vendor";
  if (!params.vendor.paymentRecipientId || params.vendor.paymentRecipientId !== params.recipientId) {
    return "mismatched_recipient";
  }
  if (params.vendor.quotedAmount == null || params.amount <= 0) return "incomplete_deposit";
  if (params.currency !== "INR") return "foreign_currency_deposit";
  if (params.previousQuoteFingerprint && params.previousQuoteFingerprint !== params.vendor.quoteFingerprint) {
    return "quote_changed";
  }
  return "approved_deposit";
}

export async function saveWeddingEvent(params: {
  agent: BuilderAgentRecord;
  userId: string;
  intake: WeddingIntake;
  eventId?: string;
}): Promise<WeddingEvent> {
  const admin = createAdminClient();
  const agent = await ensureWeddingMission(admin, params.agent);
  if (params.eventId) {
    const existing = await loadEvent(admin, { eventId: params.eventId, userId: params.userId, agent });
    if (!existing) throw new Error("Wedding event not found.");
    const plan = params.intake.isDraft ? existing.plan : buildWeddingPlan(params.intake);
    return persistEvent(
      admin,
      agent,
      { ...existing, intake: params.intake, plan, idempotencyKey: eventFingerprint(params.intake) },
      "update"
    );
  }

  const idempotencyKey = eventFingerprint(params.intake);
  const existing =
    (await findWeddingEventByIdempotency(admin, {
      userId: params.userId,
      agentId: agent.id,
      idempotencyKey,
    })) ?? weddingEventsFromSafety(agent.safetySettings).find((item) => item.idempotencyKey === idempotencyKey);
  if (existing) {
    return persistEvent(admin, agent, { ...existing, intake: params.intake, plan: params.intake.isDraft ? existing.plan : buildWeddingPlan(params.intake) }, "update");
  }

  const created: WeddingEvent = {
    id: randomUUID(),
    organizationId: agent.organizationId,
    userId: params.userId,
    agentId: agent.id,
    idempotencyKey,
    intake: params.intake,
    plan: params.intake.isDraft ? null : buildWeddingPlan(params.intake),
    vendors: [],
    tasks: defaultTasks(),
    invitation: null,
    deposits: [],
    budget: buildBudget({ intake: params.intake, vendors: [], deposits: [] }),
    conflicts: [],
    safety: emptySafety(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return persistEvent(admin, agent, created, "insert");
}

function defaultTasks(): WeddingTask[] {
  return [
    "Venue booking",
    "Caterer confirmation",
    "Décor selection",
    "Photography and entertainment",
    "Guest-list preparation",
    "Invitations",
    "Seating arrangements",
    "Rehearsal and ceremony schedule",
    "Vendor arrival times",
    "Event-day tasks",
  ].map((title) => ({ id: randomUUID(), title, done: false }));
}

export async function planWeddingEvent(params: {
  agent: BuilderAgentRecord;
  userId: string;
  intake: WeddingIntake;
  eventId?: string;
}): Promise<WeddingEvent> {
  const saved = await saveWeddingEvent({ ...params, intake: { ...params.intake, isDraft: false } });
  const admin = createAdminClient();
  const agent = await ensureWeddingMission(admin, params.agent);
  const loaded = loadedAgentFromRecord(agent);
  const control = await evaluateToolThroughControlLayer(admin, {
    agent: loaded,
    userId: params.userId,
    organizationId: agent.organizationId,
    toolName: PLAN_WEDDING_TOOL,
    actionType: PLAN_WEDDING_ACTION,
    toolInput: {
      eventName: saved.intake.eventName,
      startDate: saved.intake.startDate,
      _weddingEventId: saved.id,
    },
    source: "wedding_planner",
  });
  const planned = await persistEvent(
    admin,
    agent,
    {
      ...saved,
      safety: controlToSafety({
        decision: control.decision,
        actionType: PLAN_WEDDING_ACTION,
        toolName: PLAN_WEDDING_TOOL,
        amountInr: saved.intake.budgetCurrency === "INR" ? saved.intake.budgetAmount : null,
        reason: control.reason,
        matchedPolicies: control.matchedPolicies,
        proposalId: control.proposalId,
      }),
    },
    "update"
  );
  trackWeddingRun(admin, agent, params.userId, planned, "plan");
  return planned;
}

export async function addWeddingVendor(params: {
  agent: BuilderAgentRecord;
  userId: string;
  eventId: string;
  vendor: Omit<WeddingVendor, "id" | "quoteFingerprint" | "allowlistStatus" | "verificationStatus" | "source" | "availability"> & {
    quotedAmount: number | null;
  };
}): Promise<WeddingEvent> {
  const admin = createAdminClient();
  const agent = await ensureWeddingMission(admin, params.agent);
  const event = await loadEvent(admin, { eventId: params.eventId, userId: params.userId, agent });
  if (!event) throw new Error("Wedding event not found.");
  const id = randomUUID();
  const vendor: WeddingVendor = {
    ...params.vendor,
    id,
    source: "organizer_entered",
    verificationStatus: "unverified",
    availability: "unknown",
    allowlistStatus: "not_approved",
    quoteFingerprint: vendorQuoteFingerprint({
      id,
      name: params.vendor.name,
      quotedAmount: params.vendor.quotedAmount,
      currency: params.vendor.currency,
    }),
  };
  return persistEvent(admin, agent, { ...event, vendors: [...event.vendors, vendor] }, "update");
}

export async function actOnWeddingVendor(params: {
  agent: BuilderAgentRecord;
  userId: string;
  eventId: string;
  vendorId: string;
  action: "approve" | "remove" | "update_quote";
  quotedAmount?: number;
}): Promise<WeddingEvent> {
  const admin = createAdminClient();
  const agent = await ensureWeddingMission(admin, params.agent);
  const event = await loadEvent(admin, { eventId: params.eventId, userId: params.userId, agent });
  if (!event) throw new Error("Wedding event not found.");
  if (params.action === "remove") {
    return persistEvent(
      admin,
      agent,
      { ...event, vendors: event.vendors.filter((vendor) => vendor.id !== params.vendorId) },
      "update"
    );
  }
  if (params.action === "update_quote") {
    const vendors = event.vendors.map((vendor) =>
      vendor.id === params.vendorId
        ? {
            ...vendor,
            quotedAmount: params.quotedAmount ?? vendor.quotedAmount,
            quoteFingerprint: vendorQuoteFingerprint({
              id: vendor.id,
              name: vendor.name,
              quotedAmount: params.quotedAmount ?? vendor.quotedAmount,
              currency: vendor.currency,
            }),
          }
        : vendor
    );
    return persistEvent(admin, agent, { ...event, vendors }, "update");
  }
  const vendors = event.vendors.map((vendor) =>
    vendor.id === params.vendorId
      ? {
          ...vendor,
          allowlistStatus: "approved" as const,
          approvedBy: params.userId,
          approvedAt: new Date().toISOString(),
        }
      : vendor
  );
  return persistEvent(admin, agent, { ...event, vendors }, "update");
}

export async function addWeddingTask(params: {
  agent: BuilderAgentRecord;
  userId: string;
  eventId: string;
  task: Omit<WeddingTask, "id" | "done">;
}): Promise<WeddingEvent> {
  const admin = createAdminClient();
  const agent = await ensureWeddingMission(admin, params.agent);
  const event = await loadEvent(admin, { eventId: params.eventId, userId: params.userId, agent });
  if (!event) throw new Error("Wedding event not found.");
  return persistEvent(
    admin,
    agent,
    { ...event, tasks: [...event.tasks, { ...params.task, id: randomUUID(), done: false }] },
    "update"
  );
}

export async function actOnWeddingTask(params: {
  agent: BuilderAgentRecord;
  userId: string;
  eventId: string;
  taskId: string;
  action: "toggle" | "remove";
}): Promise<WeddingEvent> {
  const admin = createAdminClient();
  const agent = await ensureWeddingMission(admin, params.agent);
  const event = await loadEvent(admin, { eventId: params.eventId, userId: params.userId, agent });
  if (!event) throw new Error("Wedding event not found.");
  const tasks =
    params.action === "remove"
      ? event.tasks.filter((task) => task.id !== params.taskId)
      : event.tasks.map((task) => (task.id === params.taskId ? { ...task, done: !task.done } : task));
  return persistEvent(admin, agent, { ...event, tasks }, "update");
}

export async function saveWeddingInvitation(params: {
  agent: BuilderAgentRecord;
  userId: string;
  eventId: string;
  tone: InviteTone;
  hostNames: string;
  venueName?: string;
  eventTime?: string;
  extraWording?: string;
}): Promise<WeddingEvent> {
  const admin = createAdminClient();
  const agent = await ensureWeddingMission(admin, params.agent);
  const event = await loadEvent(admin, { eventId: params.eventId, userId: params.userId, agent });
  if (!event) throw new Error("Wedding event not found.");
  return persistEvent(
    admin,
    agent,
    {
      ...event,
      invitation: {
        tone: params.tone,
        hostNames: params.hostNames,
        venueName: params.venueName,
        eventTime: params.eventTime,
        extraWording: params.extraWording,
        draft: draftInvitation({
          intake: event.intake,
          tone: params.tone,
          hostNames: params.hostNames,
          venueName: params.venueName,
          eventTime: params.eventTime,
          extraWording: params.extraWording,
        }),
        updatedAt: new Date().toISOString(),
      },
    },
    "update"
  );
}

export async function requestWeddingDeposit(params: {
  agent: BuilderAgentRecord;
  userId: string;
  eventId: string;
  vendorId: string;
  amount: number;
  recipientId: string;
}): Promise<WeddingEvent> {
  const admin = createAdminClient();
  const agent = await ensureWeddingMission(admin, params.agent);
  const event = await loadEvent(admin, { eventId: params.eventId, userId: params.userId, agent });
  if (!event) throw new Error("Wedding event not found.");
  const vendor = event.vendors.find((item) => item.id === params.vendorId);
  if (!vendor) throw new Error("Vendor not found on this event.");

  const lastDeposit = [...event.deposits].reverse().find((item) => item.vendorId === vendor.id);
  const duplicate = existingOpenDeposit(event.deposits, vendor.id, params.amount, vendor.quoteFingerprint);
  if (duplicate) {
    trackWeddingRun(admin, agent, params.userId, event, "deposit");
    return event;
  }

  const resourceType = depositResourceType({
    vendor,
    amount: params.amount,
    currency: vendor.currency,
    recipientId: params.recipientId,
    previousQuoteFingerprint: lastDeposit?.quoteFingerprint,
  });
  const amountPaise = Math.round(params.amount * 100);
  const loaded = loadedAgentFromRecord(agent);
  const control = await evaluateToolThroughControlLayer(admin, {
    agent: loaded,
    userId: params.userId,
    organizationId: agent.organizationId,
    toolName: REQUEST_DEPOSIT_TOOL,
    actionType: REQUEST_DEPOSIT_ACTION,
    toolInput: {
      amount: amountPaise,
      currency: vendor.currency,
      resourceType,
      vendorId: vendor.id,
      recipientId: params.recipientId,
      _weddingEventId: event.id,
    },
    source: "wedding_planner",
  });

  const safety = controlToSafety({
    decision: control.decision,
    actionType: REQUEST_DEPOSIT_ACTION,
    toolName: REQUEST_DEPOSIT_TOOL,
    amountInr: vendor.currency === "INR" ? params.amount : null,
    reason: control.reason,
    matchedPolicies: control.matchedPolicies,
    proposalId: control.proposalId,
    allowlistStatus: vendor.allowlistStatus,
    quoteVerified: vendor.quotedAmount != null,
    recipientVerified: Boolean(vendor.paymentRecipientId && vendor.paymentRecipientId === params.recipientId),
  });

  const deposit: WeddingDeposit = {
    id: randomUUID(),
    vendorId: vendor.id,
    vendorName: vendor.name,
    amount: params.amount,
    currency: vendor.currency,
    recipientId: params.recipientId,
    quoteFingerprint: vendor.quoteFingerprint,
    status:
      control.decision === "ALLOW"
        ? "pending_payment"
        : control.decision === "BLOCK"
          ? "blocked"
          : "awaiting_approval",
    provider: "none",
    reference: null,
    note:
      control.decision === "BLOCK"
        ? safety.reason
        : "No vendor payout provider is connected. This is a pending payment request, not a completed deposit.",
    proposalId: control.proposalId,
    idempotencyKey: createHash("sha256").update(`${event.id}:${vendor.id}:${params.amount}`).digest("hex"),
    createdAt: new Date().toISOString(),
  };

  const next = await persistEvent(
    admin,
    agent,
    { ...event, safety, deposits: [...event.deposits, deposit] },
    "update"
  );
  trackWeddingRun(admin, agent, params.userId, next, "deposit");
  return next;
}

function trackWeddingRun(
  admin: ReturnType<typeof createAdminClient>,
  agent: BuilderAgentRecord,
  userId: string,
  event: WeddingEvent,
  kind: "plan" | "deposit"
): void {
  trackGalleryTemplateRun({
    admin,
    agent,
    userId,
    templateSlug: "wedding-celebration-planner",
    idempotencyKey: `wedding:${kind}:${event.id}:${event.deposits.length}`,
    inputSummary:
      kind === "deposit"
        ? `Deposit request ${event.deposits[event.deposits.length - 1]?.status ?? "none"} for ${event.intake.eventName}.`
        : `Wedding plan for ${event.intake.eventName} in ${event.intake.location}.`,
    resultPayload: {
      eventId: event.id,
      plan: event.plan,
      vendors: event.vendors.map((vendor) => ({
        id: vendor.id,
        name: vendor.name,
        quotedAmount: vendor.quotedAmount,
        allowlistStatus: vendor.allowlistStatus,
      })),
      deposits: event.deposits.map((item) => ({ id: item.id, status: item.status, amount: item.amount })),
    },
    executionStatus: executionStatusFromSafety(event.safety.decision),
    safetyDecision: event.safety.decision,
    approvalState: event.safety.approvalStatus,
    sources: ["stated_preferences"],
  });
}

export async function loadWeddingWorkspace(
  supabase: SupabaseClient,
  params: { userId: string; agent: BuilderAgentRecord }
): Promise<{ event: WeddingEvent | null; depositThresholdInr: number; comparison: string[] }> {
  const admin = createAdminClient();
  const agent = await ensureWeddingMission(admin, params.agent);
  const event =
    (await getLatestWeddingEvent(supabase, { userId: params.userId, agentId: agent.id })) ??
    weddingEventsFromSafety(agent.safetySettings)[0] ??
    null;
  return {
    depositThresholdInr:
      agent.safetySettings.thresholdInr && agent.safetySettings.thresholdInr > 0
        ? agent.safetySettings.thresholdInr
        : 10_000,
    event,
    comparison: event ? compareVendors(event.vendors, event.intake) : [],
  };
}

export async function saveWeddingSettings(params: {
  agent: BuilderAgentRecord;
  depositThresholdInr: number;
}): Promise<number> {
  const admin = createAdminClient();
  const safetySettings = {
    ...params.agent.safetySettings,
    thresholdInr: params.depositThresholdInr,
    weddingPlanner: {
      ...params.agent.safetySettings.weddingPlanner,
      depositThresholdInr: params.depositThresholdInr,
    },
  };
  await updateBuilderAgent(admin, {
    agentId: params.agent.id,
    userId: params.agent.userId,
    patch: { safetySettings, suggestedThreshold: params.depositThresholdInr },
  });
  return params.depositThresholdInr;
}
