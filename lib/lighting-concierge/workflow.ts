import type { AgentSafetySettings } from "@/lib/agents/runtime-types";
import { missionConfigEnablesLock } from "@/lib/safety/mission";
import {
  CREATE_QUOTE_ACTION,
  CREATE_QUOTE_TOOL,
  REQUEST_VISIT_ACTION,
  REQUEST_VISIT_TOOL,
  VERIFY_ADDRESS_ACTION,
  VERIFY_ADDRESS_TOOL,
} from "./constants";
import type { AddressVerificationStatus, LightingAppointment, LightingJob } from "./types";

export const LIGHTING_MISSION = {
  goal: "Recommend lighting from customer intake and the provider rate table, then request a verified electrician visit. Do not treat a typed address as verified or a pending request as a booked appointment.",
  allowedTools: [CREATE_QUOTE_TOOL, VERIFY_ADDRESS_TOOL, REQUEST_VISIT_TOOL],
  allowedActions: [CREATE_QUOTE_ACTION, VERIFY_ADDRESS_ACTION, REQUEST_VISIT_ACTION],
};

const MISSION_PASSTHROUGH = new Set([
  "No explicit mission lock configured.",
  "Action is within the agent mission scope.",
]);

export function applyLightingMission(safety: AgentSafetySettings): {
  next: AgentSafetySettings;
  changed: boolean;
} {
  const thresholdInr = safety.thresholdInr && safety.thresholdInr > 0 ? safety.thresholdInr : 5000;
  let next: AgentSafetySettings = safety.thresholdInr === thresholdInr ? safety : { ...safety, thresholdInr };
  let changed = next !== safety;
  if (!missionConfigEnablesLock(next.mission)) {
    next = { ...next, mission: { ...LIGHTING_MISSION } };
    changed = true;
  }
  return { next, changed };
}

export function visitResourceType(
  addressStatus: AddressVerificationStatus,
  hasAddress: boolean
): "missing_address" | "verified_address" | "unverified_address" {
  if (!hasAddress || addressStatus === "missing") return "missing_address";
  if (addressStatus === "verified") return "verified_address";
  return "unverified_address";
}

export function lightingControlReason(params: {
  reason: string;
  matchedPolicies: Array<{ name: string; reason: string }>;
}): string {
  const policyReason = params.matchedPolicies[0]?.reason?.trim();
  if (policyReason && MISSION_PASSTHROUGH.has(params.reason)) return policyReason;
  if (MISSION_PASSTHROUGH.has(params.reason) && policyReason) return policyReason;
  return params.reason;
}

export function shouldReuseVisitDecision(job: LightingJob, resourceType: string): boolean {
  if (job.appointment.status === "pending_confirmation") return true;
  if (job.appointment.status === "awaiting_approval" && job.appointment.proposalId) return true;
  return job.appointment.status === "blocked" && resourceType === "missing_address";
}

export function shouldReuseAddressVerification(job: LightingJob): boolean {
  return job.address.status === "verified" || (job.address.status === "pending_review" && Boolean(job.address.proposalId));
}

export function visitContact(job: LightingJob): string {
  return job.intake.contactPhone?.trim() || job.intake.contactEmail?.trim() || "No contact on file";
}

export function visitRequestId(job: LightingJob): string {
  return `LC-VISIT-${job.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export function buildVisitRequestOutput(params: {
  job: LightingJob;
  requestedAt: string;
  proposalId?: string | null;
  notificationId?: string | null;
  preferredAt?: string | null;
}): LightingAppointment {
  const address = params.job.address.address?.trim() || params.job.intake.serviceAddress.trim();
  const preferredAt =
    params.preferredAt ?? params.job.appointment.preferredAt ?? params.job.intake.preferredAppointmentAt ?? null;
  const contact = visitContact(params.job);
  const requestId = params.job.appointment.requestId || visitRequestId(params.job);
  const lines = [
    `Request ${requestId} created for ${params.job.intake.customerName}.`,
    `Verified site address: ${address || "not recorded"}.`,
    `Customer contact: ${contact}.`,
    `Estimate from the provider rate table: ₹${params.job.quote.totalInr.toLocaleString("en-IN")} (not a binding quote).`,
    preferredAt
      ? `Preferred time: ${preferredAt}. The electrician still has to confirm this slot.`
      : "No preferred time was given. The electrician still has to propose a slot.",
    "WAVE has no live electrician calendar, so this is a pending visit request, not a booked appointment.",
  ];
  return {
    status: "pending_confirmation",
    requestedAt: params.requestedAt,
    preferredAt,
    proposalId: params.proposalId ?? params.job.appointment.proposalId ?? null,
    customerConfirmed: true,
    requestId,
    customerName: params.job.intake.customerName,
    contact,
    verifiedAddress: address,
    estimateInr: params.job.quote.totalInr,
    summary: lines.join(" "),
    outputLines: lines,
    notificationId: params.notificationId ?? params.job.appointment.notificationId ?? null,
    note: "Visit request created. Waiting for the electrician to confirm a slot.",
  };
}

export function appointmentFromControl(params: {
  decision: "ALLOW" | "REVIEW" | "BLOCK";
  previous: LightingAppointment;
  job: LightingJob;
  proposalId: string | null;
  preferredAt?: string | null;
  reason: string;
}): LightingAppointment {
  const preferredAt = params.preferredAt ?? params.previous.preferredAt ?? null;
  if (params.decision === "ALLOW") {
    return buildVisitRequestOutput({
      job: { ...params.job, appointment: params.previous },
      requestedAt: new Date().toISOString(),
      proposalId: params.proposalId,
      preferredAt,
    });
  }
  if (params.decision === "REVIEW") {
    return {
      status: "awaiting_approval",
      requestedAt: new Date().toISOString(),
      preferredAt,
      proposalId: params.proposalId,
      note: "WAVE requires approval before this visit request can be stored as pending confirmation.",
      customerConfirmed: true,
    };
  }
  return {
    status: "blocked",
    requestedAt: new Date().toISOString(),
    preferredAt,
    proposalId: params.proposalId,
    note: params.reason,
    customerConfirmed: true,
  };
}
