import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFallbackInterpretation,
  interpretAgentRequest,
} from "./interpret-agent-request";

describe("buildFallbackInterpretation", () => {
  it("interprets X founder engagement example", () => {
    const result = buildFallbackInterpretation(
      "Every morning, find interesting posts from AI founders on X and prepare thoughtful replies."
    );

    assert.match(result.displayName, /Agent$/i);
    assert.match(result.goal, /X|posts|replies/i);
    assert.match(result.scheduleSummary, /morning/i);
    assert.ok(result.capabilityIds.includes("x"));
    assert.equal(result.protectionSummary, "Wave checks important actions before they happen.");
  });

  it("includes web_search for AI news agents", () => {
    const result = buildFallbackInterpretation(
      "Create an agent that finds new AI news every morning and gives me a short summary."
    );

    assert.ok(result.capabilityIds.includes("web_search"));
    assert.ok(result.tools.includes("web_search"));
    assert.equal(result.tools.includes("send_email"), false);
    assert.match(result.goal, /AI news/i);
    assert.equal(result.displayName, "AI News Agent");
  });

  it("uses fetch_url for YouTube summarizers instead of inventing content", () => {
    const result = buildFallbackInterpretation(
      "Create an agent that summarizes YouTube videos from a link I paste."
    );
    assert.equal(result.displayName, "YouTube Summary Agent");
    assert.ok(result.capabilityIds.includes("web_page"));
    assert.ok(result.tools.includes("fetch_url"));
    assert.equal(result.tools.includes("query_supabase"), false);
  });

  it("includes email capability for refund requests", () => {
    const result = buildFallbackInterpretation(
      "Send refund confirmation emails when refunds are issued under five thousand rupees."
    );

    assert.ok(result.capabilityIds.includes("email") || result.capabilityIds.includes("refunds"));
    assert.ok(result.tools.length > 0);
  });
});

describe("interpretAgentRequest", () => {
  it("uses the local fallback interpreter", async () => {
    const result = await interpretAgentRequest(
      "Every morning, find interesting posts from AI founders on X and prepare thoughtful replies."
    );

    assert.ok(result.displayName.length > 0);
    assert.ok(result.capabilityIds.includes("x"));
  });
});
