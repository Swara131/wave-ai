import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LoadedAgent } from "@/lib/agents/runtime/types";
import { evaluateAction } from "@/lib/safety/gate";
import { applyWeddingDecisionToEvent, weddingDecisionIsAuthorized } from "./approvals";
import {
  DEPOSIT_REVIEW_THRESHOLD_INR,
  PLAN_WEDDING_ACTION,
  PLAN_WEDDING_TOOL,
  REQUEST_DEPOSIT_ACTION,
  REQUEST_DEPOSIT_TOOL,
} from "./constants";
import { weddingIntakeSchema, normalizeWeddingIntake } from "./intake";
import {
  buildBudget,
  buildWeddingPlan,
  compareVendors,
  draftInvitation,
  findScheduleConflicts,
} from "./plan";
import { mergeWeddingEventIntoSafety, weddingEventsFromSafety } from "./repository";
import { depositResourceType, existingOpenDeposit } from "./service";
import type { WeddingEvent, WeddingVendor } from "./types";

function agent(): LoadedAgent {
  return {
    gatewayAgentId: "wedding-celebration-planner-agent",
    systemPrompt: "",
    enabledTools: [PLAN_WEDDING_TOOL, REQUEST_DEPOSIT_TOOL],
    record: {
      id: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      organizationId: "33333333-3333-4333-8333-333333333333",
      name: "Wedding & Celebration Planner",
      slug: "wedding-celebration-planner-agent",
      description: "Wedding",
      goal: "Plan weddings",
      instructions: "Do not invent vendors.",
      model: null,
      source: "template:wedding-celebration-planner",
      tools: [PLAN_WEDDING_TOOL, REQUEST_DEPOSIT_TOOL],
      capabilities: [],
      triggerType: "webhook",
      schedule: { when: "manual" },
      timezone: "Asia/Kolkata",
      memoryEnabled: false,
      safetySettings: {
        thresholdInr: DEPOSIT_REVIEW_THRESHOLD_INR,
        mission: {
          goal: "Wedding",
          allowedTools: [PLAN_WEDDING_TOOL, REQUEST_DEPOSIT_TOOL],
        },
      },
      suggestedThreshold: DEPOSIT_REVIEW_THRESHOLD_INR,
      status: "draft",
      publishedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

function intake() {
  return normalizeWeddingIntake(
    weddingIntakeSchema.parse({
      eventName: "Ananya & Rohan's wedding",
      eventType: "wedding",
      startDate: "2026-12-12",
      location: "Jaipur",
      guestCount: 180,
      budgetAmount: 850000,
      budgetCurrency: "INR",
      couplePreferences: "Garden venue and vegetarian food",
      familyPreferences: "Traditional pheras and a large guest list",
      cuisine: "Vegetarian thali",
    })
  );
}

function vendor(partial: Partial<WeddingVendor> = {}): WeddingVendor {
  return {
    id: "vendor-1",
    name: "Lakeview Gardens",
    category: "venue",
    quotedAmount: 250000,
    currency: "INR",
    source: "organizer_entered",
    verificationStatus: "unverified",
    availability: "unknown",
    allowlistStatus: "approved",
    paymentRecipientId: "recv-lakeview",
    quoteFingerprint: "fp-1",
    ...partial,
  };
}

describe("Wedding planner intake and plan", () => {
  it("creates and reopens an event from stored safety data", () => {
    const event: WeddingEvent = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      organizationId: "o",
      userId: "u",
      agentId: "a",
      idempotencyKey: "k",
      intake: intake(),
      plan: buildWeddingPlan(intake()),
      vendors: [],
      tasks: [],
      invitation: null,
      deposits: [],
      budget: buildBudget({ intake: intake(), vendors: [], deposits: [] }),
      conflicts: [],
      safety: {
        decision: "ALLOW",
        actionType: PLAN_WEDDING_ACTION,
        toolName: PLAN_WEDDING_TOOL,
        estimatedAmountInr: 850000,
        policyRules: [],
        reason: "ok",
        approvalStatus: "not_required",
        timestamp: new Date().toISOString(),
        executionStatus: "executed",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const saved = mergeWeddingEventIntoSafety({}, event);
    const loaded = weddingEventsFromSafety(saved);
    assert.equal(loaded[0]?.intake.eventName, event.intake.eventName);
  });

  it("saves and edits preferences without using Qloo", () => {
    const first = intake();
    const edited = { ...first, cuisine: "Jain vegetarian only" };
    const plan = buildWeddingPlan(edited);
    assert.equal(plan.source, "stated_preferences");
    assert.ok(plan.recommendations.some((item) => item.reason.includes("Jain vegetarian")));
    assert.equal(plan.recommendations.every((item) => !/qloo/i.test(item.reason)), true);
  });

  it("records differing family preferences without overriding the couple", () => {
    const plan = buildWeddingPlan(intake());
    assert.ok(plan.differingPreferences.length > 0);
    assert.ok(plan.differingPreferences.some((item) => /will not pick a winner/i.test(item)));
  });

  it("compares vendors from stored quotes only", () => {
    const notes = compareVendors(
      [vendor({ quotedAmount: 100000, name: "A" }), vendor({ id: "v2", quotedAmount: 300000, name: "B" })],
      intake()
    );
    assert.ok(notes.some((note) => /Lowest entered quote: A/.test(note)));
  });

  it("calculates planned spend from entered quotes", () => {
    const budget = buildBudget({
      intake: intake(),
      vendors: [vendor({ quotedAmount: 100000 }), vendor({ id: "v2", quotedAmount: 50000, category: "caterer" })],
      deposits: [],
    });
    assert.equal(budget.planned, 150000);
    assert.equal(budget.remaining, 700000);
  });

  it("drafts an editable invitation from event details", () => {
    const draft = draftInvitation({
      intake: intake(),
      tone: "warm",
      hostNames: "The Shah families",
      venueName: "Lakeview Gardens",
    });
    assert.match(draft, /Ananya & Rohan's wedding/);
    assert.match(draft, /has not been sent/);
  });

  it("warns when the same vendor is assigned to overlapping tasks", () => {
    const conflicts = findScheduleConflicts([
      { id: "t1", title: "Setup", dueDate: "2026-12-12", startTime: "10:00", endTime: "13:00", vendorId: "vendor-1", done: false },
      { id: "t2", title: "Lunch", dueDate: "2026-12-12", startTime: "12:00", endTime: "15:00", vendorId: "vendor-1", done: false },
    ]);
    assert.equal(conflicts.length, 1);
  });

  it("rejects invalid dates and budgets", () => {
    assert.equal(weddingIntakeSchema.safeParse({ ...intake(), eventName: "" }).success, false);
    assert.equal(weddingIntakeSchema.safeParse({ ...intake(), budgetAmount: 50 }).success, false);
    assert.equal(
      weddingIntakeSchema.safeParse({ ...intake(), startDate: "2026-12-13", endDate: "2026-12-12" }).success,
      false
    );
  });
});

describe("Wedding planner safety", () => {
  it("allows event planning", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: PLAN_WEDDING_TOOL,
      action: PLAN_WEDDING_ACTION,
      parameters: { eventName: "Wedding" },
    });
    assert.equal(result.decision, "ALLOW");
  });

  it("allows a ₹9,999 deposit to an approved vendor as a pending payment", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: REQUEST_DEPOSIT_TOOL,
      action: REQUEST_DEPOSIT_ACTION,
      parameters: { resourceType: "approved_deposit", currency: "INR", amount: 999_900 },
    });
    assert.equal(result.decision, "ALLOW");
  });

  it("requires review at exactly ₹10,000", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: REQUEST_DEPOSIT_TOOL,
      action: REQUEST_DEPOSIT_ACTION,
      parameters: { resourceType: "approved_deposit", currency: "INR", amount: 1_000_000 },
    });
    assert.equal(result.decision, "REQUIRE_APPROVAL");
  });

  it("requires review above ₹10,000", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: REQUEST_DEPOSIT_TOOL,
      action: REQUEST_DEPOSIT_ACTION,
      parameters: { resourceType: "approved_deposit", currency: "INR", amount: 2_500_000 },
    });
    assert.equal(result.decision, "REQUIRE_APPROVAL");
  });

  it("blocks a payment to a vendor who is not on the allowlist", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: REQUEST_DEPOSIT_TOOL,
      action: REQUEST_DEPOSIT_ACTION,
      parameters: { resourceType: "unapproved_vendor", currency: "INR", amount: 50_000 },
    });
    assert.equal(result.decision, "BLOCK");
    assert.equal(depositResourceType({ vendor: vendor({ allowlistStatus: "not_approved" }), amount: 500, currency: "INR", recipientId: "recv-lakeview" }), "unapproved_vendor");
  });

  it("blocks a mismatched payment recipient", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: REQUEST_DEPOSIT_TOOL,
      action: REQUEST_DEPOSIT_ACTION,
      parameters: { resourceType: "mismatched_recipient", currency: "INR", amount: 50_000 },
    });
    assert.equal(result.decision, "BLOCK");
    assert.equal(
      depositResourceType({
        vendor: vendor(),
        amount: 500,
        currency: "INR",
        recipientId: "someone-else",
      }),
      "mismatched_recipient"
    );
  });

  it("requires review for incomplete deposits and non-INR amounts", () => {
    const incomplete = evaluateAction({
      agent: agent(),
      tool: REQUEST_DEPOSIT_TOOL,
      action: REQUEST_DEPOSIT_ACTION,
      parameters: { resourceType: "incomplete_deposit", currency: "INR", amount: 50_000 },
    });
    assert.equal(incomplete.decision, "REQUIRE_APPROVAL");
    const foreign = evaluateAction({
      agent: agent(),
      tool: REQUEST_DEPOSIT_TOOL,
      action: REQUEST_DEPOSIT_ACTION,
      parameters: { resourceType: "foreign_currency_deposit", currency: "USD", amount: 50_000 },
    });
    assert.equal(foreign.decision, "REQUIRE_APPROVAL");
    assert.equal(
      depositResourceType({
        vendor: vendor({ currency: "USD" }),
        amount: 500,
        currency: "USD",
        recipientId: "recv-lakeview",
      }),
      "foreign_currency_deposit"
    );
    assert.equal(
      depositResourceType({
        vendor: vendor({ quoteFingerprint: "fp-2" }),
        amount: 500,
        currency: "INR",
        recipientId: "recv-lakeview",
        previousQuoteFingerprint: "fp-1",
      }),
      "quote_changed"
    );
  });

  it("requires review when a quote changes after approval", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: REQUEST_DEPOSIT_TOOL,
      action: REQUEST_DEPOSIT_ACTION,
      parameters: { resourceType: "quote_changed", currency: "INR", amount: 50_000 },
    });
    assert.equal(result.decision, "REQUIRE_APPROVAL");
  });

  it("blocks duplicate open deposit requests", () => {
    const deposits = [
      {
        id: "d1",
        vendorId: "vendor-1",
        vendorName: "Lakeview",
        amount: 9999,
        currency: "INR",
        recipientId: "recv-lakeview",
        quoteFingerprint: "fp-1",
        status: "pending_payment" as const,
        provider: "none" as const,
        reference: null,
        note: "pending",
        idempotencyKey: "dup",
        createdAt: new Date().toISOString(),
      },
    ];
    assert.ok(existingOpenDeposit(deposits, "vendor-1", 9999));
    assert.equal(existingOpenDeposit(deposits, "vendor-1", 10000), undefined);
  });

  it("keeps approved deposits as awaiting payment, not paid", () => {
    const event: WeddingEvent = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      organizationId: "o",
      userId: "u",
      agentId: "a",
      idempotencyKey: "k",
      intake: intake(),
      plan: null,
      vendors: [vendor()],
      tasks: [],
      invitation: null,
      deposits: [
        {
          id: "d1",
          vendorId: "vendor-1",
          vendorName: "Lakeview",
          amount: 10000,
          currency: "INR",
          recipientId: "recv-lakeview",
          quoteFingerprint: "fp-1",
          status: "awaiting_approval",
          provider: "none",
          reference: null,
          note: "review",
          proposalId: "proposal-1",
          idempotencyKey: "k",
          createdAt: new Date().toISOString(),
        },
      ],
      budget: buildBudget({ intake: intake(), vendors: [vendor()], deposits: [] }),
      conflicts: [],
      safety: {
        decision: "REVIEW",
        actionType: REQUEST_DEPOSIT_ACTION,
        toolName: REQUEST_DEPOSIT_TOOL,
        estimatedAmountInr: 10000,
        policyRules: [],
        reason: "review",
        approvalStatus: "pending",
        timestamp: new Date().toISOString(),
        executionStatus: "awaiting_approval",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const next = applyWeddingDecisionToEvent(event, {
      toolName: REQUEST_DEPOSIT_TOOL,
      decision: "approved",
      proposalId: "proposal-1",
      decidedAt: new Date().toISOString(),
    });
    assert.equal(next.deposits[0].status, "approved_awaiting_payment");
    assert.equal(next.deposits[0].reference, null);
    const quoteChanged = applyWeddingDecisionToEvent(
      {
        ...event,
        vendors: [vendor({ quoteFingerprint: "fp-changed" })],
      },
      {
        toolName: REQUEST_DEPOSIT_TOOL,
        decision: "approved",
        proposalId: "proposal-1",
        decidedAt: new Date().toISOString(),
      }
    );
    assert.equal(quoteChanged.deposits[0].status, "awaiting_approval");
    const rejected = applyWeddingDecisionToEvent(event, {
      toolName: REQUEST_DEPOSIT_TOOL,
      decision: "rejected",
      proposalId: "proposal-1",
      decidedAt: new Date().toISOString(),
    });
    assert.equal(rejected.deposits[0].status, "rejected");
  });

  it("rejects an unauthorized approval for another organizer", () => {
    assert.equal(weddingDecisionIsAuthorized("user-a", "user-b"), false);
    assert.equal(weddingDecisionIsAuthorized("user-a", "user-a"), true);
  });

  it("does not isolate another user's events from safety storage keyed by event id", () => {
    const eventA = mergeWeddingEventIntoSafety(
      {},
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        organizationId: "o1",
        userId: "user-a",
        agentId: "a1",
        idempotencyKey: "k1",
        intake: intake(),
        plan: null,
        vendors: [],
        tasks: [],
        invitation: null,
        deposits: [],
        budget: buildBudget({ intake: intake(), vendors: [], deposits: [] }),
        conflicts: [],
        safety: {
          decision: "ALLOW",
          actionType: PLAN_WEDDING_ACTION,
          toolName: PLAN_WEDDING_TOOL,
          estimatedAmountInr: null,
          policyRules: [],
          reason: "ok",
          approvalStatus: "not_required",
          timestamp: new Date().toISOString(),
          executionStatus: "executed",
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    );
    const loaded = weddingEventsFromSafety(eventA);
    assert.equal(loaded[0]?.userId, "user-a");
    assert.notEqual(loaded[0]?.userId, "user-b");
  });
});
