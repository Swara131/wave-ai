import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasExplicitMissionLock } from "@/lib/safety/mission";
import { lightingIntakeFieldErrors, lightingIntakeSchema } from "./intake";
import { applyLightingDecisionToJob } from "./approvals";
import { CREATE_QUOTE_TOOL, REQUEST_VISIT_TOOL, VERIFY_ADDRESS_TOOL } from "./constants";
import { buildLightingPlan } from "./plan";
import { buildLightingQuote, defaultLightingRates } from "./pricing";
import type { LightingJob } from "./types";
import {
  applyLightingMission,
  appointmentFromControl,
  lightingControlReason,
  shouldReuseAddressVerification,
  shouldReuseVisitDecision,
  visitResourceType,
} from "./workflow";

const intake = {
  customerName: "Swara",
  contactEmail: "swara@example.com",
  contactPhone: "9975578913",
  roomType: "living_room" as const,
  roomPurpose: "Warm living room lighting",
  preferredStyle: "modern" as const,
  lightingPreference: "warm" as const,
  budgetInr: 12000,
  serviceAddress: "12 MG Road, Bengaluru 560001",
  jobKind: "new_installation" as const,
  lightsNeeded: 4,
};

function job(overrides: Partial<LightingJob> = {}): LightingJob {
  const quote = buildLightingQuote(intake, defaultLightingRates());
  const plan = buildLightingPlan(intake, quote, {
    source: "fallback",
    queriedAt: new Date().toISOString(),
    endpoint: "",
    tags: [],
    entities: [],
    errorKind: "missing_key",
    error: "Qloo is not configured.",
    usedSignals: ["modern"],
  });
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    agentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    idempotencyKey: "key",
    intake,
    plan,
    quote,
    qloo: {
      source: "fallback",
      queriedAt: new Date().toISOString(),
      endpoint: "",
      tags: [],
      entities: [],
      errorKind: "missing_key",
      usedSignals: ["modern"],
    },
    safety: {
      decision: "ALLOW",
      actionType: "service.quote",
      toolName: CREATE_QUOTE_TOOL,
      estimatedAmountInr: quote.totalInr,
      policyRules: [],
      reason: "ok",
      approvalStatus: "not_required",
      timestamp: new Date().toISOString(),
      executionStatus: "executed",
    },
    address: {
      status: "unverified",
      address: intake.serviceAddress,
      method: "manual_reviewer",
    },
    appointment: { status: "none", customerConfirmed: false },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Lighting Concierge workflow", () => {
  it("builds a structured plan from valid intake", () => {
    const quote = buildLightingQuote(intake, defaultLightingRates());
    const plan = buildLightingPlan(intake, quote, {
      source: "fallback",
      queriedAt: new Date().toISOString(),
      endpoint: "",
      tags: [],
      entities: [],
      errorKind: "missing_key",
      usedSignals: ["modern"],
    });
    assert.ok(plan.layers.some((layer) => layer.name === "Ambient"));
    assert.ok(plan.colourTemperatureKelvin.range.includes("2700K"));
    assert.equal(plan.colourTemperatureKelvin.source, "general_lighting_guidance");
    assert.ok(quote.totalInr > 0);
    assert.equal(quote.binding, false);
  });

  it("returns field errors for missing required inputs", () => {
    const parsed = lightingIntakeSchema.safeParse({
      customerName: "",
      roomType: "living_room",
      preferredStyle: "modern",
      lightingPreference: "warm",
      budgetInr: 12000,
      jobKind: "new_installation",
    });
    assert.equal(parsed.success, false);
    if (parsed.success) return;
    const fields = lightingIntakeFieldErrors(parsed.error);
    assert.ok(fields.customerName);
    assert.ok(fields.contactEmail);
  });

  it("enables a lighting mission lock without financial restrictions", () => {
    const { next, changed } = applyLightingMission({ thresholdInr: 5000 });
    assert.equal(changed, true);
    assert.ok(
      hasExplicitMissionLock({
        gatewayAgentId: "x",
        systemPrompt: "",
        enabledTools: [],
        record: {
          id: "11111111-1111-4111-8111-111111111111",
          userId: "u",
          organizationId: "o",
          name: "Lighting",
          slug: "lighting",
          description: "",
          goal: "",
          instructions: null,
          model: null,
          source: "template:lighting-concierge",
          tools: [],
          capabilities: [],
          triggerType: "webhook",
          schedule: {},
          timezone: "UTC",
          memoryEnabled: false,
          safetySettings: next,
          suggestedThreshold: 5000,
          status: "draft",
          publishedAt: null,
          createdAt: "",
          updatedAt: "",
        },
      })
    );
    assert.ok(next.mission?.allowedTools?.includes(REQUEST_VISIT_TOOL));
  });

  it("prefers the policy reason over a mission pass-through", () => {
    assert.equal(
      lightingControlReason({
        reason: "No explicit mission lock configured.",
        matchedPolicies: [{ name: "Installation needs an address", reason: "An installation visit cannot be requested without a service address." }],
      }),
      "An installation visit cannot be requested without a service address."
    );
  });

  it("does not create duplicate visit or verification requests", () => {
    const pending = job({
      appointment: { status: "pending_confirmation", customerConfirmed: true, proposalId: "p1" },
    });
    assert.equal(shouldReuseVisitDecision(pending, "verified_address"), true);
    const blocked = job({ appointment: { status: "blocked", customerConfirmed: true } });
    assert.equal(shouldReuseVisitDecision(blocked, "missing_address"), true);
    assert.equal(shouldReuseVisitDecision(blocked, "verified_address"), false);
    const reviewing = job({
      address: { status: "pending_review", address: intake.serviceAddress, method: "manual_reviewer", proposalId: "p2" },
    });
    assert.equal(shouldReuseAddressVerification(reviewing), true);
  });

  it("stores allowed visits as pending confirmation, not booked", () => {
    const next = appointmentFromControl({
      decision: "ALLOW",
      previous: { status: "none", customerConfirmed: false },
      job: job(),
      proposalId: null,
      preferredAt: null,
      reason: "ok",
    });
    assert.equal(next.status, "pending_confirmation");
    assert.ok(next.requestId);
    assert.ok((next.outputLines ?? []).length > 0);
    assert.match(next.note ?? "", /Visit request created/i);
  });

  it("records authorised address verification and does not auto-verify", () => {
    assert.equal(visitResourceType("unverified", true), "unverified_address");
    const pending = applyLightingDecisionToJob(job(), {
      toolName: VERIFY_ADDRESS_TOOL,
      decision: "approved",
      actorId: "reviewer-1",
      note: "Called customer and confirmed the pin.",
      decidedAt: "2026-10-25T12:00:00.000Z",
      proposalId: "proposal-1",
    });
    assert.equal(pending.address.status, "verified");
    assert.equal(pending.address.verifiedBy, "reviewer-1");
    assert.equal(pending.address.method, "manual_reviewer");

    const visit = applyLightingDecisionToJob(job({ address: pending.address }), {
      toolName: REQUEST_VISIT_TOOL,
      decision: "approved",
      actorId: "reviewer-1",
      decidedAt: "2026-10-25T12:05:00.000Z",
      proposalId: "proposal-2",
    });
    assert.equal(visit.appointment.status, "pending_confirmation");
    assert.ok(visit.appointment.requestId);
    assert.match(visit.appointment.summary ?? "", /pending visit request/i);

    const proceeded = applyLightingDecisionToJob(
      job({
        appointment: { status: "awaiting_approval", customerConfirmed: true, proposalId: "proposal-visit" },
      }),
      {
        toolName: VERIFY_ADDRESS_TOOL,
        decision: "approved",
        actorId: "reviewer-1",
        decidedAt: "2026-10-25T12:10:00.000Z",
        proposalId: "proposal-address",
      }
    );
    assert.equal(proceeded.address.status, "verified");
    assert.equal(proceeded.appointment.status, "pending_confirmation");
    assert.ok((proceeded.appointment.outputLines ?? []).length > 0);
  });
});
