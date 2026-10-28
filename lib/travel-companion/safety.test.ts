import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LoadedAgent } from "@/lib/agents/runtime/types";
import { evaluateAction } from "@/lib/safety/gate";
import { fetchTravelTaste } from "@/lib/qloo/client";
import {
  PLAN_ITINERARY_ACTION,
  PLAN_ITINERARY_TOOL,
  REQUEST_BOOKING_ACTION,
  REQUEST_BOOKING_TOOL,
} from "./constants";
import { travelIntakeSchema } from "./intake";
import { activitiesOverlap, buildTravelItinerary } from "./itinerary";
import { applyTravelDecisionToTrip } from "./approvals";
import { normalizeTravelIntake } from "./intake";
import { existingOpenBooking } from "./service";
import { mergeTravelTripIntoSafety, travelTripsFromSafety } from "./repository";
import type { TravelActivity, TravelTrip } from "./types";

function agent(): LoadedAgent {
  return {
    gatewayAgentId: "travel-companion-agent",
    systemPrompt: "",
    enabledTools: [PLAN_ITINERARY_TOOL, REQUEST_BOOKING_TOOL],
    record: {
      id: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      organizationId: "33333333-3333-4333-8333-333333333333",
      name: "Travel Companion",
      slug: "travel-companion-agent",
      description: "Travel",
      goal: "Plan local discovery trips",
      instructions: "Do not invent bookings.",
      model: null,
      source: "template:travel-companion",
      tools: [PLAN_ITINERARY_TOOL, REQUEST_BOOKING_TOOL],
      capabilities: [],
      triggerType: "webhook",
      schedule: { when: "manual" },
      timezone: "Asia/Kolkata",
      memoryEnabled: false,
      safetySettings: { thresholdInr: 5000, mission: { goal: "Travel", allowedTools: [PLAN_ITINERARY_TOOL, REQUEST_BOOKING_TOOL] } },
      suggestedThreshold: 5000,
      status: "draft",
      publishedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

const fallbackQloo = {
  source: "fallback" as const,
  queriedAt: new Date().toISOString(),
  endpoint: "",
  tags: [],
  entities: [],
  errorKind: "missing_key" as const,
  usedSignals: ["Jaipur"],
};

function urlCalledPlaceInsights(endpoint: string) {
  return /filter\.type=urn(:|%3A)entity(:|%3A)place/i.test(endpoint) && /filter\.location\.query=/i.test(endpoint);
}

function intake() {
  return normalizeTravelIntake(
    travelIntakeSchema.parse({
      destination: "Jaipur",
      startDate: "2026-11-10",
      endDate: "2026-11-12",
      travelers: 2,
      budgetAmount: 18000,
      budgetCurrency: "INR",
      interests: ["food", "history"],
      pace: "balanced",
    })
  );
}

describe("Travel Companion intake and itinerary", () => {
  it("builds a valid single-day itinerary", () => {
    const oneDay = normalizeTravelIntake(
      travelIntakeSchema.parse({ ...intake(), startDate: "2026-11-10", endDate: "2026-11-10" })
    );
    const plan = buildTravelItinerary(oneDay, fallbackQloo);
    assert.equal(plan.days.length, 1);
    assert.ok(plan.days[0].activities.length >= 2);
    assert.equal(plan.conflicts.length, 0);
  });

  it("builds a multi-day itinerary", () => {
    const plan = buildTravelItinerary(intake(), fallbackQloo);
    assert.equal(plan.days.length, 3);
    assert.ok(plan.days.every((day) => day.activities.length > 0));
  });

  it("rejects missing destination or invalid dates", () => {
    assert.equal(travelIntakeSchema.safeParse({ ...intake(), destination: "" }).success, false);
    assert.equal(
      travelIntakeSchema.safeParse({ ...intake(), startDate: "2026-11-12", endDate: "2026-11-10" }).success,
      false
    );
  });

  it("rejects a budget below the minimum", () => {
    assert.equal(travelIntakeSchema.safeParse({ ...intake(), budgetAmount: 50 }).success, false);
  });

  it("detects overlapping activity times", () => {
    const a: TravelActivity = {
      id: "a",
      dayIndex: 0,
      dayDate: "2026-11-10",
      part: "morning",
      startTime: "10:00",
      endTime: "12:00",
      title: "Walk",
      category: "history",
      location: "Jaipur",
      durationMinutes: 120,
      estimatedCostPerPerson: null,
      costVerified: false,
      reason: "test",
      qlooInformed: false,
      source: "stated_preferences",
      availability: "unknown",
      hoursVerified: false,
      travelTimeVerified: false,
      bookingRequired: false,
      flags: [],
    };
    const b = { ...a, id: "b", startTime: "11:00", endTime: "13:00", title: "Lunch" };
    assert.equal(activitiesOverlap(a, b), true);
    assert.equal(activitiesOverlap(a, { ...b, startTime: "12:00", endTime: "13:00" }), false);
  });
});

describe("Travel Companion safety", () => {
  it("allows itinerary planning", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: PLAN_ITINERARY_TOOL,
      action: PLAN_ITINERARY_ACTION,
      parameters: { destination: "Jaipur" },
    });
    assert.equal(result.decision, "ALLOW");
  });

  it("requires review for an unverified booking", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: REQUEST_BOOKING_TOOL,
      action: REQUEST_BOOKING_ACTION,
      parameters: { resourceType: "incomplete_booking", currency: "INR", amount: 0 },
    });
    assert.equal(result.decision, "REQUIRE_APPROVAL");
  });

  it("requires review at and above ₹5,000", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: REQUEST_BOOKING_TOOL,
      action: REQUEST_BOOKING_ACTION,
      parameters: { resourceType: "pending_request", currency: "INR", amount: 500_000 },
    });
    assert.equal(result.decision, "REQUIRE_APPROVAL");
  });

  it("allows a pending request below the INR threshold when complete enough", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: REQUEST_BOOKING_TOOL,
      action: REQUEST_BOOKING_ACTION,
      parameters: { resourceType: "pending_request", currency: "INR", amount: 499_900 },
    });
    assert.equal(result.decision, "ALLOW");
    assert.equal(result.canExecute, true);
  });

  it("requires approval for multi-day bookings", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: REQUEST_BOOKING_TOOL,
      action: REQUEST_BOOKING_ACTION,
      parameters: { resourceType: "multiday_booking", currency: "INR", amount: 100_000 },
    });
    assert.equal(result.decision, "REQUIRE_APPROVAL");
  });

  it("blocks overlapping bookings", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: REQUEST_BOOKING_TOOL,
      action: REQUEST_BOOKING_ACTION,
      parameters: { resourceType: "overlapping_booking", currency: "INR", amount: 0 },
    });
    assert.equal(result.decision, "BLOCK");
  });

  it("keeps approved bookings as pending confirmation, not purchased", () => {
    const trip = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      organizationId: "o",
      userId: "u",
      agentId: "a",
      idempotencyKey: "k",
      intake: intake(),
      itinerary: buildTravelItinerary(intake(), fallbackQloo),
      qloo: fallbackQloo,
      safety: {
        decision: "REVIEW" as const,
        actionType: REQUEST_BOOKING_ACTION,
        toolName: REQUEST_BOOKING_TOOL,
        estimatedAmountInr: null,
        policyRules: [],
        reason: "review",
        approvalStatus: "pending" as const,
        timestamp: new Date().toISOString(),
        executionStatus: "awaiting_approval" as const,
      },
      bookings: [
        {
          id: "b1",
          activityId: "act",
          title: "Dinner",
          date: "2026-11-10",
          startTime: "18:30",
          endTime: "20:30",
          partySize: 2,
          amount: null,
          currency: "INR",
          status: "awaiting_approval" as const,
          provider: "none" as const,
          reference: null,
          note: "pending",
          proposalId: "proposal-1",
          idempotencyKey: "dup",
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies TravelTrip;
    const next = applyTravelDecisionToTrip(trip, {
      toolName: REQUEST_BOOKING_TOOL,
      decision: "approved",
      proposalId: "proposal-1",
      decidedAt: new Date().toISOString(),
    });
    assert.equal(next.bookings[0].status, "pending_confirmation");
    assert.equal(next.bookings[0].reference, null);
  });
});

describe("Travel Companion Qloo", () => {
  it("falls back when the API key is missing", async () => {
    const previous = process.env.QLOO_API_KEY;
    delete process.env.QLOO_API_KEY;
    const result = await fetchTravelTaste({ destination: "Jaipur", interests: ["food"], extraQueries: [] });
    if (previous === undefined) delete process.env.QLOO_API_KEY;
    else process.env.QLOO_API_KEY = previous;
    assert.equal(result.source, "fallback");
    assert.equal(result.errorKind, "missing_key");
  });

  it("uses real Qloo places when the API succeeds", async () => {
    const previous = process.env.QLOO_API_KEY;
    const originalFetch = globalThis.fetch;
    process.env.QLOO_API_KEY = "test-qloo-key";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v2/tags")) {
        return new Response(
          JSON.stringify({
            success: true,
            results: { tags: [{ tag_id: "urn:tag:genre:media:folk", name: "Folk" }] },
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          results: {
            entities: [
              {
                entity_id: "place-hawa-mahal",
                name: "Hawa Mahal",
                properties: { address: "Hawa Mahal Rd, Badi Choupad" },
              },
            ],
          },
        }),
        { status: 200 }
      );
    }) as typeof fetch;
    const result = await fetchTravelTaste({ destination: "Jaipur", interests: ["music"], extraQueries: [] });
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.QLOO_API_KEY;
    else process.env.QLOO_API_KEY = previous;
    assert.equal(result.source, "qloo");
    assert.ok(result.entities.some((entity) => entity.name === "Hawa Mahal"));
    assert.ok(urlCalledPlaceInsights(result.endpoint));
  });

  it("falls back when Qloo returns no results or fails", async () => {
    const previous = process.env.QLOO_API_KEY;
    const originalFetch = globalThis.fetch;
    process.env.QLOO_API_KEY = "test-qloo-key";
    globalThis.fetch = (async () => new Response(JSON.stringify({ success: true, results: { tags: [] } }), { status: 200 })) as typeof fetch;
    const empty = await fetchTravelTaste({ destination: "Jaipur", interests: ["art"], extraQueries: [] });
    globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    const failed = await fetchTravelTaste({ destination: "Jaipur", interests: ["art"], extraQueries: [] });
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.QLOO_API_KEY;
    else process.env.QLOO_API_KEY = previous;
    assert.equal(empty.source, "fallback");
    assert.equal(failed.source, "fallback");
  });
});

describe("Travel Companion bookings and persistence", () => {
  it("uses Qloo place names on itinerary stops without claiming hours or tickets", () => {
    const qloo = {
      source: "qloo" as const,
      queriedAt: new Date().toISOString(),
      endpoint: "https://hackathon.api.qloo.com/v2/insights",
      tags: [],
      entities: [
        {
          entityId: "place-hawa-mahal",
          name: "Hawa Mahal",
          address: "Hawa Mahal Rd, Badi Choupad",
        },
      ],
      usedSignals: ["Jaipur"],
    };
    const plan = buildTravelItinerary(intake(), qloo);
    const activities = plan.days.flatMap((day) => day.activities);
    assert.ok(activities.every((activity) => activity.title === "Hawa Mahal"));
    assert.ok(activities.every((activity) => activity.hoursVerified === false));
    assert.ok(plan.missingInformation.some((item) => /Qloo/i.test(item)));
  });

  it("labels itinerary stops as unverified when no places provider exists", () => {
    const plan = buildTravelItinerary(intake(), fallbackQloo);
    assert.ok(plan.days.flatMap((day) => day.activities).every((activity) => activity.availability === "unknown"));
    assert.ok(plan.missingInformation.some((item) => /unverified/i.test(item)));
  });

  it("blocks duplicate open booking requests for the same activity", () => {
    const bookings = [
      {
        id: "b1",
        activityId: "act-1",
        title: "Dinner",
        date: "2026-11-10",
        startTime: "18:30",
        endTime: "20:30",
        partySize: 2,
        amount: null,
        currency: "INR",
        status: "pending_confirmation" as const,
        provider: "none" as const,
        reference: null,
        note: "pending",
        idempotencyKey: "dup",
        createdAt: new Date().toISOString(),
      },
    ];
    assert.ok(existingOpenBooking(bookings, "act-1"));
    assert.equal(existingOpenBooking(bookings, "act-2"), undefined);
  });

  it("does not treat approval as a purchased reservation", () => {
    const trip = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      organizationId: "o",
      userId: "u",
      agentId: "a",
      idempotencyKey: "k",
      intake: intake(),
      itinerary: buildTravelItinerary(intake(), fallbackQloo),
      qloo: fallbackQloo,
      safety: {
        decision: "REVIEW" as const,
        actionType: REQUEST_BOOKING_ACTION,
        toolName: REQUEST_BOOKING_TOOL,
        estimatedAmountInr: null,
        policyRules: [],
        reason: "review",
        approvalStatus: "pending" as const,
        timestamp: new Date().toISOString(),
        executionStatus: "awaiting_approval" as const,
      },
      bookings: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies TravelTrip;
    const rejected = applyTravelDecisionToTrip(trip, {
      toolName: REQUEST_BOOKING_TOOL,
      decision: "rejected",
      proposalId: "p1",
      decidedAt: new Date().toISOString(),
    });
    assert.equal(rejected.safety.executionStatus, "rejected");
    assert.equal(rejected.bookings.some((booking) => booking.reference), false);
  });

  it("reloads a saved trip from agent safety storage", () => {
    const trip: TravelTrip = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      organizationId: "o",
      userId: "u",
      agentId: "a",
      idempotencyKey: "k",
      intake: intake(),
      itinerary: buildTravelItinerary(intake(), fallbackQloo),
      qloo: fallbackQloo,
      safety: {
        decision: "ALLOW",
        actionType: PLAN_ITINERARY_ACTION,
        toolName: PLAN_ITINERARY_TOOL,
        estimatedAmountInr: 18000,
        policyRules: [],
        reason: "ok",
        approvalStatus: "not_required",
        timestamp: new Date().toISOString(),
        executionStatus: "executed",
      },
      bookings: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const saved = mergeTravelTripIntoSafety({}, trip);
    const loaded = travelTripsFromSafety(saved);
    assert.equal(loaded[0]?.id, trip.id);
    assert.equal(loaded[0]?.intake.destination, "Jaipur");
  });
});
