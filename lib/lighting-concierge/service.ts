import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateBuilderAgent } from "@/lib/agents/repository";
import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";
import { evaluateToolThroughControlLayer } from "@/lib/agents/runtime/control/control-layer";
import { fetchLightingTaste } from "@/lib/qloo/client";
import {
  CREATE_QUOTE_ACTION,
  CREATE_QUOTE_TOOL,
  REQUEST_VISIT_ACTION,
  REQUEST_VISIT_TOOL,
  VERIFY_ADDRESS_ACTION,
  VERIFY_ADDRESS_TOOL,
} from "./constants";
import { loadedAgentFromRecord } from "./loaded-agent";
import { buildLightingPlan } from "./plan";
import { buildLightingQuote, defaultLightingRates } from "./pricing";
import {
  findLightingJobByIdempotency,
  getLightingJobForUser,
  getLatestLightingJob,
  insertLightingJob,
  isMissingLightingTable,
  lightingJobsFromSafety,
  mergeLightingJobIntoSafety,
  ratesFromSafety,
  updateLightingJob,
} from "./repository";
import type { LightingIntake, LightingJob, LightingRates, LightingSafetyRecord } from "./types";
import { executionStatusFromSafety, trackGalleryTemplateRun } from "@/lib/templates/execution-record";
import { notifyLightingVisitRequest } from "./notify";
import {
  applyLightingMission,
  appointmentFromControl,
  buildVisitRequestOutput,
  lightingControlReason,
  shouldReuseAddressVerification,
  shouldReuseVisitDecision,
  visitResourceType,
} from "./workflow";

async function ensureLightingMission(
  admin: ReturnType<typeof createAdminClient>,
  agent: BuilderAgentRecord
): Promise<BuilderAgentRecord> {
  const { next, changed } = applyLightingMission(agent.safetySettings);
  if (!changed) return agent;
  await updateBuilderAgent(admin, {
    agentId: agent.id,
    userId: agent.userId,
    patch: { safetySettings: next },
  });
  agent.safetySettings = next;
  return agent;
}

async function persistLightingJob(
  admin: ReturnType<typeof createAdminClient>,
  agent: BuilderAgentRecord,
  job: LightingJob,
  mode: "insert" | "update"
): Promise<LightingJob> {
  try {
    if (mode === "insert") {
      return await insertLightingJob(admin, job);
    }
    return await updateLightingJob(admin, {
      jobId: job.id,
      userId: agent.userId,
      patch: {
        quote: job.quote,
        plan: job.plan,
        safety: job.safety,
        address: job.address,
        appointment: job.appointment,
        qloo: job.qloo,
      },
    });
  } catch (error) {
    if (!isMissingLightingTable(error)) throw error;
    const safetySettings = mergeLightingJobIntoSafety(agent.safetySettings, job);
    await updateBuilderAgent(admin, {
      agentId: agent.id,
      userId: agent.userId,
      patch: { safetySettings },
    });
    agent.safetySettings = safetySettings;
    return job;
  }
}

async function loadLightingJob(
  admin: ReturnType<typeof createAdminClient>,
  params: { jobId: string; userId: string; agent: BuilderAgentRecord }
): Promise<LightingJob | null> {
  const fromTable = await getLightingJobForUser(admin, {
    jobId: params.jobId,
    userId: params.userId,
    agentId: params.agent.id,
  });
  if (fromTable) return fromTable;
  return lightingJobsFromSafety(params.agent.safetySettings).find((item) => item.id === params.jobId) ?? null;
}

function intakeKey(agentId: string, intake: LightingIntake, rates: LightingRates): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        agentId,
        customerName: intake.customerName,
        roomType: intake.roomType,
        roomPurpose: intake.roomPurpose,
        preferredStyle: intake.preferredStyle,
        lightingPreference: intake.lightingPreference,
        budgetInr: intake.budgetInr,
        serviceAddress: intake.serviceAddress,
        jobKind: intake.jobKind,
        lightsNeeded: intake.lightsNeeded ?? null,
        rates,
      })
    )
    .digest("hex");
}

function controlToSafety(params: {
  decision: "ALLOW" | "REVIEW" | "BLOCK";
  actionType: string;
  toolName: string;
  amountInr: number | null;
  reason: string;
  matchedPolicies: Array<{ name: string; reason: string }>;
  proposalId: string | null;
}): LightingSafetyRecord {
  return {
    decision: params.decision,
    actionType: params.actionType,
    toolName: params.toolName,
    estimatedAmountInr: params.amountInr,
    policyRules: params.matchedPolicies.map((policy) => policy.name),
    reason: lightingControlReason({
      reason: params.reason,
      matchedPolicies: params.matchedPolicies,
    }),
    approvalStatus:
      params.decision === "ALLOW"
        ? "not_required"
        : params.decision === "BLOCK"
          ? "blocked"
          : "pending",
    proposalId: params.proposalId,
    timestamp: new Date().toISOString(),
    executionStatus:
      params.decision === "ALLOW"
        ? "executed"
        : params.decision === "BLOCK"
          ? "blocked"
          : "awaiting_approval",
  };
}

export async function generateLightingPlan(params: {
  supabase: SupabaseClient;
  agent: BuilderAgentRecord;
  userId: string;
  intake: LightingIntake;
}): Promise<LightingJob> {
  const admin = createAdminClient();
  const agent = await ensureLightingMission(admin, params.agent);
  const loaded = loadedAgentFromRecord(agent);
  const rates = ratesFromSafety(agent.safetySettings) ?? defaultLightingRates();
  const idempotencyKey = intakeKey(agent.id, params.intake, rates);

  const existing =
    (await findLightingJobByIdempotency(admin, {
      userId: params.userId,
      agentId: agent.id,
      idempotencyKey,
    })) ??
    lightingJobsFromSafety(agent.safetySettings).find((item) => item.idempotencyKey === idempotencyKey);
  if (existing) {
    trackLightingRun(admin, agent, params.userId, existing, "plan");
    return existing;
  }

  const quote = buildLightingQuote(params.intake, rates);
  const qloo = await fetchLightingTaste({
    style: params.intake.preferredStyle,
    extraQueries: [
      params.intake.additionalPreferences ?? "",
      `${params.intake.preferredStyle} interior design`,
      "home décor",
    ].filter(Boolean),
  });
  const plan = buildLightingPlan(params.intake, quote, qloo);

  const jobId = randomUUID();
  const control = await evaluateToolThroughControlLayer(admin, {
    agent: loaded,
    userId: params.userId,
    organizationId: agent.organizationId,
    toolName: CREATE_QUOTE_TOOL,
    actionType: CREATE_QUOTE_ACTION,
    toolInput: {
      amount: Math.round(quote.totalInr * 100),
      currency: "INR",
      resourceType: quote.complete ? "complete_quote" : "incomplete_quote",
      quoteComplete: quote.complete,
      quoteFingerprint: quote.fingerprint,
      customerName: params.intake.customerName,
      serviceAddress: params.intake.serviceAddress,
      itemised: quote.lines,
      _lightingJobId: jobId,
    },
    source: "lighting_concierge",
  });

  const safety = controlToSafety({
    decision: control.decision,
    actionType: CREATE_QUOTE_ACTION,
    toolName: CREATE_QUOTE_TOOL,
    amountInr: quote.totalInr,
    reason: control.reason,
    matchedPolicies: control.matchedPolicies,
    proposalId: control.proposalId,
  });

  const addressStatus = params.intake.serviceAddress.trim() ? "unverified" : "missing";

  const created: LightingJob = {
    id: jobId,
    organizationId: agent.organizationId,
    userId: params.userId,
    agentId: agent.id,
    idempotencyKey,
    intake: params.intake,
    plan,
    quote,
    qloo,
    safety,
    address: {
      status: addressStatus,
      address: params.intake.serviceAddress,
      method: "manual_reviewer",
      proposalId: null,
      verifiedAt: null,
      verifiedBy: null,
    },
    appointment: {
      status: "none",
      customerConfirmed: false,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const saved = await persistLightingJob(admin, agent, created, "insert");
  trackLightingRun(admin, agent, params.userId, saved, "plan");
  return saved;
}

export async function requestAddressVerification(params: {
  agent: BuilderAgentRecord;
  userId: string;
  jobId: string;
}): Promise<LightingJob> {
  const admin = createAdminClient();
  const agent = await ensureLightingMission(admin, params.agent);
  const job = await loadLightingJob(admin, {
    jobId: params.jobId,
    userId: params.userId,
    agent,
  });
  if (!job) throw new Error("Lighting job not found.");
  if (!job.intake.serviceAddress.trim()) {
    throw new Error("A service address is required before verification. A typed address is never treated as verified.");
  }
  if (shouldReuseAddressVerification(job)) return job;

  const loaded = loadedAgentFromRecord(agent);
  const control = await evaluateToolThroughControlLayer(admin, {
    agent: loaded,
    userId: params.userId,
    organizationId: agent.organizationId,
    toolName: VERIFY_ADDRESS_TOOL,
    actionType: VERIFY_ADDRESS_ACTION,
    toolInput: {
      address: job.intake.serviceAddress,
      resourceType: "unverified_address",
      customerName: job.intake.customerName,
      _lightingJobId: job.id,
    },
    source: "lighting_concierge",
  });

  return persistLightingJob(
    admin,
    agent,
    {
      ...job,
      updatedAt: new Date().toISOString(),
      address: {
        ...job.address,
        status: "pending_review",
        method: "manual_reviewer",
        proposalId: control.proposalId,
      },
      safety: controlToSafety({
        decision: control.decision,
        actionType: VERIFY_ADDRESS_ACTION,
        toolName: VERIFY_ADDRESS_TOOL,
        amountInr: job.quote.totalInr,
        reason: control.reason,
        matchedPolicies: control.matchedPolicies,
        proposalId: control.proposalId,
      }),
    },
    "update"
  );
}

export async function requestElectricianVisit(params: {
  agent: BuilderAgentRecord;
  userId: string;
  jobId: string;
  preferredAppointmentAt?: string;
}): Promise<LightingJob> {
  const admin = createAdminClient();
  const agent = await ensureLightingMission(admin, params.agent);
  const job = await loadLightingJob(admin, {
    jobId: params.jobId,
    userId: params.userId,
    agent,
  });
  if (!job) throw new Error("Lighting job not found.");
  if (!job.intake.contactEmail?.trim() && !job.intake.contactPhone?.trim()) {
    throw new Error("Add an email address or phone number before requesting a visit.");
  }

  const hasAddress = Boolean(job.intake.serviceAddress.trim());
  const addressStatus = hasAddress ? job.address.status : "missing";
  const resourceType = visitResourceType(addressStatus, hasAddress);
  if (shouldReuseVisitDecision(job, resourceType)) return job;

  const loaded = loadedAgentFromRecord(agent);
  const preferredAt =
    params.preferredAppointmentAt ?? job.intake.preferredAppointmentAt ?? job.appointment.preferredAt ?? null;
  const control = await evaluateToolThroughControlLayer(admin, {
    agent: loaded,
    userId: params.userId,
    organizationId: agent.organizationId,
    toolName: REQUEST_VISIT_TOOL,
    actionType: REQUEST_VISIT_ACTION,
    toolInput: {
      amount: Math.round(job.quote.totalInr * 100),
      currency: "INR",
      resourceType,
      preferredAppointmentAt: preferredAt,
      _lightingJobId: job.id,
    },
    source: "lighting_concierge",
  });

  const safety = controlToSafety({
    decision: control.decision,
    actionType: REQUEST_VISIT_ACTION,
    toolName: REQUEST_VISIT_TOOL,
    amountInr: job.quote.totalInr,
    reason: control.reason,
    matchedPolicies: control.matchedPolicies,
    proposalId: control.proposalId,
  });

  let saved = await persistLightingJob(
    admin,
    agent,
    {
      ...job,
      updatedAt: new Date().toISOString(),
      safety,
      appointment: appointmentFromControl({
        decision: control.decision,
        previous: job.appointment,
        job,
        proposalId: control.proposalId,
        preferredAt,
        reason: safety.reason,
      }),
    },
    "update"
  );
  if (saved.appointment.status === "pending_confirmation") {
    const notified = await notifyLightingVisitRequest(admin, { agent, job: saved });
    if (notified.appointment.notificationId && notified.appointment.notificationId !== saved.appointment.notificationId) {
      saved = await persistLightingJob(admin, agent, notified, "update");
    }
  }
  return saved;
}

function trackLightingRun(
  admin: ReturnType<typeof createAdminClient>,
  agent: BuilderAgentRecord,
  userId: string,
  job: LightingJob,
  kind: "plan" | "visit"
): void {
  trackGalleryTemplateRun({
    admin,
    agent,
    userId,
    templateSlug: "lighting-concierge",
    idempotencyKey: `lighting:${kind}:${job.idempotencyKey}`,
    inputSummary:
      kind === "visit"
        ? `Visit request ${job.appointment.status} for ${job.intake.customerName}.`
        : `Lighting plan for ${job.intake.roomType.replace("_", " ")}. Estimate ₹${job.quote.totalInr.toLocaleString("en-IN")}.`,
    resultPayload: {
      jobId: job.id,
      plan: job.plan,
      quote: job.quote,
      qlooSource: job.qloo.source,
      appointment: job.appointment.status,
      address: job.address.status,
    },
    executionStatus: executionStatusFromSafety(job.safety.decision),
    safetyDecision: job.safety.decision,
    approvalState: job.safety.approvalStatus,
    sources: [job.qloo.source === "qloo" ? "qloo" : "stated_preferences", "rate_table"],
  });
}

export async function saveLightingRates(params: {
  supabase: SupabaseClient;
  agent: BuilderAgentRecord;
  userId: string;
  rates: Omit<LightingRates, "currency" | "source" | "updatedAt">;
}): Promise<LightingRates> {
  const next: LightingRates = {
    ...params.rates,
    currency: "INR",
    source: "provider_configured",
    updatedAt: new Date().toISOString(),
  };
  await updateBuilderAgent(params.supabase, {
    agentId: params.agent.id,
    userId: params.userId,
    patch: {
      safetySettings: {
        ...params.agent.safetySettings,
        lightingConcierge: {
          ...params.agent.safetySettings.lightingConcierge,
          rates: next,
        },
      },
    },
  });
  return next;
}

export async function loadLightingWorkspace(
  supabase: SupabaseClient,
  params: { userId: string; agent: BuilderAgentRecord }
): Promise<{ rates: LightingRates; job: LightingJob | null }> {
  const admin = createAdminClient();
  const agent = await ensureLightingMission(admin, params.agent);
  let job =
    (await getLatestLightingJob(supabase, {
      userId: params.userId,
      agentId: agent.id,
    })) ??
    lightingJobsFromSafety(agent.safetySettings)[0] ??
    null;

  if (job?.appointment.status === "pending_confirmation" && !job.appointment.outputLines?.length) {
    job = {
      ...job,
      appointment: buildVisitRequestOutput({
        job,
        requestedAt: job.appointment.requestedAt ?? job.updatedAt,
        proposalId: job.appointment.proposalId,
        preferredAt: job.appointment.preferredAt,
      }),
    };
    const notified = await notifyLightingVisitRequest(admin, { agent, job });
    job = await persistLightingJob(admin, agent, notified, "update");
  }

  return {
    rates: ratesFromSafety(agent.safetySettings) ?? defaultLightingRates(),
    job,
  };
}
