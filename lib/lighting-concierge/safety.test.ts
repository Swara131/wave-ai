import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LoadedAgent } from "@/lib/agents/runtime/types";
import { evaluateAction } from "@/lib/safety/gate";
import {
  CREATE_QUOTE_ACTION,
  CREATE_QUOTE_TOOL,
  REQUEST_VISIT_ACTION,
  REQUEST_VISIT_TOOL,
  VERIFY_ADDRESS_ACTION,
  VERIFY_ADDRESS_TOOL,
} from "./constants";
import { lightingIntakeSchema } from "./intake";
import { buildLightingQuote, defaultLightingRates, inrToPaise } from "./pricing";
import { isLightingConciergeProposal } from "./approvals";

function agent(): LoadedAgent {
  return {
    gatewayAgentId: "lighting-concierge-agent",
    systemPrompt: "",
    enabledTools: [
      CREATE_QUOTE_TOOL,
      VERIFY_ADDRESS_TOOL,
      REQUEST_VISIT_TOOL,
    ],
    record: {
      id: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      organizationId: "33333333-3333-4333-8333-333333333333",
      name: "Lighting Concierge",
      slug: "lighting-concierge-agent",
      description: "Lighting Concierge for electricians",
      goal: "Recommend lighting and request electrician visits",
      instructions: "Use configured rates. Do not invent bookings.",
      model: null,
      source: "template:lighting-concierge",
      tools: [CREATE_QUOTE_TOOL, VERIFY_ADDRESS_TOOL, REQUEST_VISIT_TOOL],
      capabilities: [],
      triggerType: "webhook",
      schedule: { when: "manual" },
      timezone: "Asia/Kolkata",
      memoryEnabled: false,
      safetySettings: { thresholdInr: 5000 },
      suggestedThreshold: 5000,
      status: "draft",
      publishedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

function quoteAction(amountInr: number, complete: boolean) {
  return evaluateAction({
    agent: agent(),
    tool: CREATE_QUOTE_TOOL,
    action: CREATE_QUOTE_ACTION,
    parameters: {
      amount: inrToPaise(amountInr),
      currency: "INR",
      resourceType: complete ? "complete_quote" : "incomplete_quote",
      quoteComplete: complete,
    },
  });
}

describe("Lighting Concierge safety", () => {
  it("allows a complete quote of ₹4,999", () => {
    const result = quoteAction(4999, true);
    assert.equal(result.decision, "ALLOW");
    assert.equal(result.canExecute, true);
  });

  it("requires approval at exactly ₹5,000", () => {
    const result = quoteAction(5000, true);
    assert.equal(result.decision, "REQUIRE_APPROVAL");
  });

  it("requires approval above ₹5,000", () => {
    const result = quoteAction(12500, true);
    assert.equal(result.decision, "REQUIRE_APPROVAL");
  });

  it("marks an incomplete quote as review", () => {
    const result = quoteAction(2000, false);
    assert.equal(result.decision, "REQUIRE_APPROVAL");
  });

  it("blocks an installation request without an address", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: REQUEST_VISIT_TOOL,
      action: REQUEST_VISIT_ACTION,
      parameters: { resourceType: "missing_address", currency: "INR", amount: 0 },
    });
    assert.equal(result.decision, "BLOCK");
    assert.match(result.reason, /address/i);
    assert.doesNotMatch(result.reason, /No explicit mission lock configured/);
  });

  it("requires review for an unverified address", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: REQUEST_VISIT_TOOL,
      action: REQUEST_VISIT_ACTION,
      parameters: { resourceType: "unverified_address", currency: "INR", amount: 499900 },
    });
    assert.equal(result.decision, "REQUIRE_APPROVAL");
  });

  it("allows a pending visit request only after verification", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: REQUEST_VISIT_TOOL,
      action: REQUEST_VISIT_ACTION,
      parameters: { resourceType: "verified_address", currency: "INR", amount: 499900 },
    });
    assert.equal(result.decision, "ALLOW");
  });

  it("always sends address verification to a human reviewer", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: VERIFY_ADDRESS_TOOL,
      action: VERIFY_ADDRESS_ACTION,
      parameters: { address: "12 MG Road, Bengaluru", resourceType: "unverified_address" },
    });
    assert.equal(result.decision, "REQUIRE_APPROVAL");
  });

  it("rejects intake without email or phone", () => {
    const parsed = lightingIntakeSchema.safeParse({
      customerName: "Asha",
      roomType: "kitchen",
      roomPurpose: "Family cooking and homework",
      preferredStyle: "modern",
      lightingPreference: "neutral",
      budgetInr: 15000,
      serviceAddress: "12 MG Road, Bengaluru 560001",
      jobKind: "new_installation",
    });
    assert.equal(parsed.success, false);
  });

  it("allows a plan without a service address and ignores empty optional numbers", () => {
    const parsed = lightingIntakeSchema.safeParse({
      customerName: "Swara",
      contactEmail: "swarakorane@gmail.com",
      contactPhone: "9975578913",
      roomType: "living_room",
      roomPurpose: "Warm living room lighting",
      preferredStyle: "modern",
      lightingPreference: "warm",
      budgetInr: 12000,
      serviceAddress: "",
      jobKind: "new_installation",
      lightsNeeded: "",
      preferredAppointmentAt: "",
    });
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.serviceAddress, "");
      assert.equal(parsed.data.lightsNeeded, undefined);
    }

    const omitted = lightingIntakeSchema.safeParse({
      customerName: "Swara",
      contactPhone: "9975578913",
      roomType: "living_room",
      preferredStyle: "modern",
      lightingPreference: "warm",
      budgetInr: 12000,
      jobKind: "new_installation",
    });
    assert.equal(omitted.success, true);
  });

  it("does not treat a typed address as verified", () => {
    const quote = buildLightingQuote(
      {
        customerName: "Asha",
        contactEmail: "asha@example.com",
        roomType: "living_room",
        roomPurpose: "Evening family use",
        preferredStyle: "modern",
        lightingPreference: "warm",
        budgetInr: 18000,
        serviceAddress: "12 MG Road, Bengaluru 560001",
        jobKind: "new_installation",
        lightsNeeded: 6,
      },
      defaultLightingRates()
    );
    assert.equal(quote.binding, false);
    assert.ok(quote.totalInr > 0);
  });

  it("changes the quote fingerprint when the customer revises the request", () => {
    const rates = defaultLightingRates();
    const base = {
      customerName: "Asha",
      contactEmail: "asha@example.com",
      roomType: "living_room" as const,
      roomPurpose: "Evening family use",
      preferredStyle: "modern" as const,
      lightingPreference: "warm" as const,
      budgetInr: 18000,
      serviceAddress: "12 MG Road, Bengaluru 560001",
      jobKind: "new_installation" as const,
      lightsNeeded: 6,
    };
    const first = buildLightingQuote(base, rates);
    const revised = buildLightingQuote({ ...base, lightsNeeded: 10 }, rates);
    assert.notEqual(first.fingerprint, revised.fingerprint);
  });

  it("identifies lighting proposals for the approvals queue", () => {
    assert.equal(
      isLightingConciergeProposal({
        tool_name: CREATE_QUOTE_TOOL,
        action_payload: {},
      }),
      true
    );
  });

  it("blocks tools outside a lighting mission lock", () => {
    const locked = agent();
    locked.record.safetySettings = {
      thresholdInr: 5000,
      mission: {
        goal: "Lighting concierge only",
        allowedTools: [CREATE_QUOTE_TOOL, VERIFY_ADDRESS_TOOL, REQUEST_VISIT_TOOL],
      },
    };
    const blocked = evaluateAction({
      agent: locked,
      tool: "send_email",
      action: "communication.email",
      parameters: { to: "a@example.com" },
    });
    assert.equal(blocked.decision, "BLOCK");
    assert.match(blocked.reason, /not in the mission allowlist/i);

    const allowed = quoteAction(4999, true);
    const lockedQuote = evaluateAction({
      agent: locked,
      tool: CREATE_QUOTE_TOOL,
      action: CREATE_QUOTE_ACTION,
      parameters: {
        amount: inrToPaise(4999),
        currency: "INR",
        resourceType: "complete_quote",
        quoteComplete: true,
      },
    });
    assert.equal(allowed.decision, "ALLOW");
    assert.equal(lockedQuote.decision, "ALLOW");
  });
});
