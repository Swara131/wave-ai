import assert from "node:assert/strict";
import test from "node:test";
import { agentRunInputPath } from "./run-input-path";
import { getGroqVisionModels } from "@/lib/groq/env";

test("photo jobs open the photo page", () => {
  assert.equal(
    agentRunInputPath("custom-agent-5", [{ key: "venue_photo", inputType: "file" }]),
    "/agents/custom-agent-5/photo"
  );
});

test("lighting jobs open the Lighting Concierge page", () => {
  assert.equal(
    agentRunInputPath("lighting-concierge-agent", [{ key: "lighting_intake", inputType: "text" }]),
    "/agents/lighting-concierge-agent/lighting"
  );
});

test("travel jobs open the Travel Companion page", () => {
  assert.equal(
    agentRunInputPath("travel-companion-agent", [{ key: "travel_intake", inputType: "text" }]),
    "/agents/travel-companion-agent/travel"
  );
});

test("wedding jobs open the Wedding Planner page", () => {
  assert.equal(
    agentRunInputPath("wedding-celebration-planner-agent", [{ key: "wedding_intake", inputType: "text" }]),
    "/agents/wedding-celebration-planner-agent/wedding"
  );
});

test("group jobs open the Group Decision Planner page", () => {
  assert.equal(
    agentRunInputPath("group-decision-planner-agent", [{ key: "group_intake", inputType: "text" }]),
    "/agents/group-decision-planner-agent/group"
  );
});

test("link jobs open the run page", () => {
  assert.equal(
    agentRunInputPath("yt-1", [{ key: "source_url", inputType: "url" }]),
    "/agents/yt-1/run"
  );
});

test("Groq vision uses a model this workspace can actually call", () => {
  assert.ok(getGroqVisionModels().includes("qwen/qwen3.8-27b"));
});
