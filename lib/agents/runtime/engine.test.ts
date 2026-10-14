import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fallbackModelTurn } from "./model/fallback-provider";
import { resolveActionType } from "./tools/definitions";
import { assertToolEnabledForAgent } from "./tools/registry";
import type { LoadedAgent, ModelCompletionRequest } from "./types";

function mockAgent(tools: string[]): LoadedAgent {
  return {
    gatewayAgentId: "test-agent",
    enabledTools: tools,
    systemPrompt: "test",
    record: {
      id: "00000000-0000-4000-8000-000000000001",
      userId: "user",
      organizationId: "org",
      name: "Test Agent",
      slug: "test-agent",
      description: "Test",
      goal: "Test goal",
      instructions: null,
      model: null,
      source: "test",
      tools,
      capabilities: [],
      triggerType: "schedule",
      schedule: {},
      timezone: "UTC",
      memoryEnabled: false,
      safetySettings: {},
      suggestedThreshold: 5000,
      status: "published",
      publishedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

describe("runtime tool registry", () => {
  it("blocks tools not enabled on the agent", () => {
    assert.throws(
      () => assertToolEnabledForAgent(["send_email"], "issue_refund"),
      /not enabled/
    );
  });

  it("maps tool names to action types", () => {
    assert.equal(resolveActionType("send_email"), "communication.email");
  });
});

describe("fallback model provider", () => {
  it("completes simple tasks without tools", async () => {
    const request: ModelCompletionRequest = {
      agent: mockAgent(["send_email"]),
      task: "Summarize today's priorities",
      messages: [],
      enabledToolNames: ["send_email"],
    };

    const turn = await fallbackModelTurn(request);
    assert.equal(turn.type, "complete");
  });

  it("does not call send_email without a saved recipient", async () => {
    const request: ModelCompletionRequest = {
      agent: mockAgent(["send_email"]),
      task: "Send a confirmation email to the customer",
      messages: [],
      enabledToolNames: ["send_email"],
    };

    const turn = await fallbackModelTurn(request);
    assert.equal(turn.type, "complete");
    if (turn.type === "complete") {
      assert.match(turn.message, /Prepare your agent|GROQ_API_KEY/i);
    }
  });

  it("requests send_email when a recipient is saved", async () => {
    const agent = mockAgent(["send_email"]);
    agent.record.safetySettings = {
      delivery: {
        mode: "email",
        destinationEmail: "ops@example.com",
        destinationPhone: null,
      },
    };
    const request: ModelCompletionRequest = {
      agent,
      task: "Send a confirmation email to the customer",
      messages: [],
      enabledToolNames: ["send_email"],
    };

    const turn = await fallbackModelTurn(request);
    assert.equal(turn.type, "tool_call");
    if (turn.type === "tool_call") {
      assert.equal(turn.toolName, "send_email");
    }
  });

  it("does not call send_email when the agent is Wave-only", async () => {
    const agent = mockAgent(["send_email"]);
    agent.record.safetySettings = {
      delivery: {
        mode: "notification",
        destinationEmail: "ops@example.com",
        destinationPhone: null,
      },
    };
    const turn = await fallbackModelTurn({
      agent,
      task: "Send a confirmation email to the customer",
      messages: [],
      enabledToolNames: ["send_email"],
    });
    assert.equal(turn.type, "complete");
  });
});
