import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { LoadedAgent } from "@/lib/agents/runtime/types";
import { fetchGroupDiningTaste, QlooClientError, searchQlooEntities } from "@/lib/qloo/client";
import { evaluateAction } from "@/lib/safety/gate";
import { groupDecisionIsAuthorized } from "./approvals";
import {
  PLAN_GROUP_ACTION,
  PLAN_GROUP_TOOL,
  REQUEST_RESERVATION_ACTION,
  REQUEST_RESERVATION_TOOL,
  RESERVATION_REVIEW_THRESHOLD_INR,
} from "./constants";
import { groupIntakeSchema, normalizeGroupIntake } from "./intake";
import { mergeGroupOutingIntoSafety, groupOutingsFromSafety } from "./repository";
import { candidatesFromQloo, pickThreeRecommendations, scoreCandidate } from "./score";
import { reservationResourceType } from "./service";
import type { GroupOuting, RestaurantCandidate } from "./types";

function agent(): LoadedAgent {
  return {
    gatewayAgentId: "group-decision-planner-agent",
    systemPrompt: "",
    enabledTools: [PLAN_GROUP_TOOL, REQUEST_RESERVATION_TOOL],
    record: {
      id: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      organizationId: "33333333-3333-4333-8333-333333333333",
      name: "Group Decision Planner",
      slug: "group-decision-planner-agent",
      description: "Group",
      goal: "Group Decision Planner",
      instructions: "Use Qloo when configured.",
      model: null,
      source: "template:group-decision-planner",
      tools: [PLAN_GROUP_TOOL, REQUEST_RESERVATION_TOOL],
      capabilities: [],
      triggerType: "webhook",
      schedule: { when: "manual" },
      timezone: "Asia/Kolkata",
      memoryEnabled: false,
      safetySettings: {
        thresholdInr: RESERVATION_REVIEW_THRESHOLD_INR,
        mission: { goal: "Group", allowedTools: [PLAN_GROUP_TOOL, REQUEST_RESERVATION_TOOL] },
      },
      suggestedThreshold: RESERVATION_REVIEW_THRESHOLD_INR,
      status: "draft",
      publishedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

function people(count: 3 | 4) {
  const base = [
    { displayName: "Aisha", likes: ["A.R. Rahman", "vegetarian thali", "indie films"], preferredCuisines: "vegetarian", dietary: "vegetarian", neighborhood: "Bandra" },
    { displayName: "Rohan", likes: ["Radiohead", "sci-fi", "ramen"], preferredCuisines: "Japanese", neighborhood: "Andheri" },
    { displayName: "Meera", likes: ["jazz", "Goan seafood", "films"], preferredCuisines: "seafood", neighborhood: "Colaba" },
    { displayName: "Kabir", likes: ["biryani", "cricket", "Hindi songs"], preferredCuisines: "Mughlai", neighborhood: "Dadar" },
  ];
  return base.slice(0, count);
}

function intake(count: 3 | 4 = 4) {
  return normalizeGroupIntake(
    groupIntakeSchema.parse({
      groupName: "Saturday in Mumbai",
      city: "Mumbai",
      outingDate: "2026-11-07",
      startTime: "18:30",
      endTime: "22:00",
      maxBudgetInr: 8000,
      budgetCurrency: "INR",
      maxTravelMinutes: 40,
      participants: people(count),
    })
  );
}

function candidate(partial: Partial<RestaurantCandidate> = {}): RestaurantCandidate {
  return {
    id: partial.id ?? "urn:entity:place:one",
    name: partial.name ?? "Coastal Kitchen",
    entityId: partial.entityId ?? "urn:entity:place:one",
    cuisine: partial.cuisine ?? "vegetarian coastal",
    address: partial.address,
    neighborhood: partial.neighborhood ?? "Bandra",
    estimatedCostPerPerson:
      partial.estimatedCostPerPerson !== undefined ? partial.estimatedCostPerPerson : 900,
    currency: "INR",
    distanceMinutes: partial.distanceMinutes !== undefined ? partial.distanceMinutes : 20,
    openingHours: partial.openingHours ?? null,
    availability: "unverified",
    popularity: partial.popularity ?? 0.8,
    affinity: partial.affinity ?? 0.6,
    tags: partial.tags ?? ["vegetarian", "coastal"],
    source: partial.source ?? "qloo",
    retrievedAt: new Date().toISOString(),
    unknownFields: partial.unknownFields ?? ["opening hours", "table availability"],
  };
}

describe("Group Decision Planner intake", () => {
  it("creates a group with three participants", () => {
    const group = intake(3);
    assert.equal(group.participants.length, 3);
    assert.equal(group.participants[0].likes.length >= 3, true);
  });

  it("creates a group with four participants", () => {
    const group = intake(4);
    assert.equal(group.participants.length, 4);
    assert.notEqual(group.participants[0].likes.join(), group.participants[1].likes.join());
  });

  it("rejects missing preferences and invalid budgets", () => {
    assert.equal(groupIntakeSchema.safeParse({ ...intake(), maxBudgetInr: 10 }).success, false);
    const bad = groupIntakeSchema.safeParse({
      groupName: "x",
      city: "Mumbai",
      outingDate: "2026-11-07",
      startTime: "18:30",
      maxBudgetInr: 8000,
      maxTravelMinutes: 40,
      participants: [{ displayName: "A", likes: ["one"] }],
    });
    assert.equal(bad.success, false);
  });
});

describe("Group Decision Planner ranking", () => {
  it("filters hard budget and dietary constraints", () => {
    const overBudget = scoreCandidate(candidate({ estimatedCostPerPerson: 9000, id: "expensive" }), intake(), []);
    assert.equal(overBudget.hardPass, false);
    const meat = scoreCandidate(candidate({ id: "steak", name: "Steak House", tags: ["steak", "barbecue"], cuisine: "steak" }), intake(), []);
    assert.equal(meat.hardPass, false);
  });

  it("picks best overall, fairest, and discovery as distinct restaurants", () => {
    const candidates = [
      candidate({ id: "a", name: "Coastal Kitchen", popularity: 0.9, affinity: 0.8, estimatedCostPerPerson: 800, tags: ["vegetarian", "coastal"] }),
      candidate({ id: "b", name: "Ramen Alley", popularity: 0.7, affinity: 0.5, cuisine: "Japanese ramen", tags: ["ramen", "Japanese"], estimatedCostPerPerson: 700 }),
      candidate({ id: "c", name: "Quiet Discovery Cafe", popularity: 0.1, affinity: 0.4, cuisine: "vegetarian", tags: ["vegetarian", "cafe"], estimatedCostPerPerson: 500 }),
      candidate({ id: "d", name: "Mughlai Room", popularity: 0.6, affinity: 0.3, cuisine: "Mughlai vegetarian", tags: ["vegetarian", "biryani"], estimatedCostPerPerson: 750 }),
    ];
    const picked = pickThreeRecommendations(candidates, intake(), []);
    assert.equal(picked.recommendations.length, 3);
    assert.equal(picked.tooFewReason, null);
    const kinds = picked.recommendations.map((item) => item.kind).sort();
    assert.deepEqual(kinds, ["best_overall", "discovery", "fairest"].sort());
    const ids = picked.recommendations.map((item) => item.scored.candidate.id);
    assert.equal(new Set(ids).size, 3);
  });

  it("re-ranks after a participant rejects a restaurant", () => {
    const candidates = [
      candidate({ id: "a", name: "Coastal Kitchen" }),
      candidate({ id: "b", name: "Ramen Alley", cuisine: "Japanese ramen", tags: ["ramen", "Japanese"] }),
      candidate({ id: "c", name: "Quiet Discovery Cafe", popularity: 0.1, cuisine: "vegetarian", tags: ["vegetarian"] }),
    ];
    const before = pickThreeRecommendations(candidates, intake(), []);
    assert.ok(before.recommendations.some((item) => item.scored.candidate.id === "a"));
    const after = pickThreeRecommendations(candidates, intake(), [
      {
        id: "f1",
        participantId: intake().participants[0].id,
        restaurantId: "a",
        restaurantName: "Coastal Kitchen",
        reason: "food",
        createdAt: new Date().toISOString(),
      },
    ]);
    assert.equal(after.recommendations.some((item) => item.scored.candidate.id === "a"), false);
  });

  it("explains too few valid candidates instead of fabricating options", () => {
    const picked = pickThreeRecommendations([candidate({ estimatedCostPerPerson: 9000 })], intake(), []);
    assert.equal(picked.recommendations.length, 0);
    assert.match(picked.tooFewReason ?? "", /hard constraint|fabricate/i);
  });

  it("labels missing restaurant details as unknown", () => {
    const scored = scoreCandidate(candidate({ address: undefined, estimatedCostPerPerson: null, distanceMinutes: null, openingHours: null }), intake(), []);
    assert.ok(scored.unknownFlags.includes("price"));
    assert.ok(scored.unknownFlags.includes("travel time"));
    assert.ok(scored.unknownFlags.includes("opening hours"));
  });
});

describe("Group Decision Planner Qloo client", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.QLOO_API_KEY;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.QLOO_API_KEY;
    else process.env.QLOO_API_KEY = originalKey;
  });

  it("falls back when the API key is missing", async () => {
    const previous = process.env.QLOO_API_KEY;
    delete process.env.QLOO_API_KEY;
    const result = await fetchGroupDiningTaste({ city: "Mumbai", likeQueries: ["ramen"] });
    if (previous === undefined) delete process.env.QLOO_API_KEY;
    else process.env.QLOO_API_KEY = previous;
    assert.equal(result.source, "fallback");
    assert.equal(result.errorKind, "missing_key");
    assert.equal(result.entities.length, 0);
  });

  it("resolves entities and places from Qloo payloads", async () => {
    const previous = process.env.QLOO_API_KEY;
    process.env.QLOO_API_KEY = "test-qloo-key";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v2/tags")) {
        return new Response(JSON.stringify({ results: { tags: [{ tag_id: "urn:tag:genre:music:indie", name: "Indie" }] } }), { status: 200 });
      }
      if (url.includes("/search") || url.includes("/v2/search")) {
        return new Response(JSON.stringify({ results: { entities: [{ entity_id: "urn:entity:artist:radiohead", name: "Radiohead" }] } }), { status: 200 });
      }
      if (url.includes("urn:entity:place") || url.includes("urn%3Aentity%3Aplace")) {
        return new Response(
          JSON.stringify({
            results: {
              entities: [
                {
                  entity_id: "urn:entity:place:coastal",
                  name: "Coastal Kitchen",
                  popularity: 0.4,
                  properties: { address: "Bandra West" },
                  query: { affinity: 0.7 },
                  tags: [{ name: "vegetarian" }],
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ results: { entities: [] } }), { status: 200 });
    }) as typeof fetch;
    const result = await fetchGroupDiningTaste({ city: "Mumbai", likeQueries: ["Radiohead"] });
    if (previous === undefined) delete process.env.QLOO_API_KEY;
    else process.env.QLOO_API_KEY = previous;
    assert.equal(result.source, "qloo");
    assert.ok(result.entities.some((item) => item.entityId === "urn:entity:place:coastal"));
    assert.equal(result.entities[0]?.address, "Bandra West");
  });

  it("classifies Qloo rate limits", async () => {
    const previous = process.env.QLOO_API_KEY;
    process.env.QLOO_API_KEY = "test-qloo-key";
    globalThis.fetch = (async () => new Response("slow", { status: 429 })) as typeof fetch;
    await assert.rejects(() => searchQlooEntities("Radiohead"), (err: unknown) => {
      assert.ok(err instanceof QlooClientError);
      assert.equal(err.kind, "rate_limited");
      return true;
    });
    if (previous === undefined) delete process.env.QLOO_API_KEY;
    else process.env.QLOO_API_KEY = previous;
  });

  it("does not invent entity IDs on empty Qloo results", () => {
    const mapped = candidatesFromQloo([], new Date().toISOString(), "qloo");
    assert.equal(mapped.length, 0);
  });
});

describe("Group Decision Planner safety", () => {
  it("allows recommendation generation without a booking", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: PLAN_GROUP_TOOL,
      action: PLAN_GROUP_ACTION,
      parameters: { city: "Mumbai" },
    });
    assert.equal(result.decision, "ALLOW");
  });

  it("stores a pending confirmation when no booking provider exists", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: REQUEST_RESERVATION_TOOL,
      action: REQUEST_RESERVATION_ACTION,
      parameters: { resourceType: "pending_confirmation", currency: "INR", amount: 400_000 },
    });
    assert.equal(result.decision, "ALLOW");
  });

  it("requires review at the reservation threshold", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: REQUEST_RESERVATION_TOOL,
      action: REQUEST_RESERVATION_ACTION,
      parameters: { resourceType: "pending_confirmation", currency: "INR", amount: 500_000 },
    });
    assert.equal(result.decision, "REQUIRE_APPROVAL");
  });

  it("blocks duplicate reservation requests", () => {
    const result = evaluateAction({
      agent: agent(),
      tool: REQUEST_RESERVATION_TOOL,
      action: REQUEST_RESERVATION_ACTION,
      parameters: { resourceType: "duplicate_reservation", currency: "INR", amount: 100_000 },
    });
    assert.equal(result.decision, "BLOCK");
    const outing = {
      reservation: { status: "pending_confirmation" },
      itinerary: { restaurantId: "a" },
      intake: { budgetCurrency: "INR", participants: [1, 2] },
    } as unknown as GroupOuting;
    assert.equal(reservationResourceType(outing), "duplicate_reservation");
  });

  it("rejects unauthorized access to another organizer's outing", () => {
    assert.equal(groupDecisionIsAuthorized("user-a", "user-b"), false);
  });

  it("reopens a saved group from safety storage", () => {
    const outing: GroupOuting = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      organizationId: "o",
      userId: "user-a",
      agentId: "a",
      idempotencyKey: "k",
      intake: intake(),
      qloo: { source: "fallback", queriedAt: new Date().toISOString(), endpoint: "", tags: [], entities: [], usedSignals: [] },
      candidates: [],
      recommendations: [],
      feedback: [],
      history: [],
      itinerary: null,
      reservation: null,
      safety: {
        decision: "ALLOW",
        actionType: PLAN_GROUP_ACTION,
        toolName: PLAN_GROUP_TOOL,
        estimatedAmountInr: null,
        policyRules: [],
        reason: "ok",
        approvalStatus: "not_required",
        timestamp: new Date().toISOString(),
        executionStatus: "executed",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const loaded = groupOutingsFromSafety(mergeGroupOutingIntoSafety({}, outing));
    assert.equal(loaded[0]?.intake.groupName, "Saturday in Mumbai");
    assert.equal(loaded[0]?.userId, "user-a");
    assert.notEqual(loaded[0]?.userId, "user-b");
  });
});
