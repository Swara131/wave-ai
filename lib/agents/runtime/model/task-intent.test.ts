import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveExecutableTestTask,
  deriveWebSearchQuery,
  isPromptEcho,
  taskNeedsWebResearch,
} from "./task-intent";
import type { LoadedAgent } from "../types";

function mockAgent(tools: string[], goal?: string): LoadedAgent {
  return {
    record: {
      id: "agent-1",
      organizationId: "org-1",
      slug: "research-agent",
      name: "Research Agent",
      description: "Finds research",
      goal: goal ?? "Find research",
      instructions: "",
      tools,
      status: "testing",
      capabilities: [],
      schedule: {},
      timezone: "UTC",
      memoryEnabled: false,
      safetySettings: {},
      publishedAt: null,
      createdAt: "",
      updatedAt: "",
      triggerType: "webhook",
      model: null,
      userId: "user-1",
      source: "test",
      suggestedThreshold: 5000,
    },
    gatewayAgentId: "research-agent",
    systemPrompt: "test",
    enabledTools: tools,
  };
}

describe("task-intent", () => {
  it("derives an executable test task from agent-creation wording", () => {
    assert.equal(
      deriveExecutableTestTask(
        "Create an agent that finds new AI news every morning and gives me a short summary.",
        null
      ),
      "finds new AI news every morning and gives me a short summary."
    );
  });

  it("detects prompt echo completions", () => {
    const task = "Find the latest AI news and give me a short summary.";
    assert.equal(isPromptEcho(`Completed: ${task}`, task), true);
    assert.equal(isPromptEcho(task, task), true);
    assert.equal(isPromptEcho("AI NEWS SUMMARY\n\n1. OpenAI releases...", task), false);
    assert.equal(
      isPromptEcho(`${task}\n\nUse this saved configuration:\n- ticket source: helpdesk`, task),
      true
    );
  });

  it("requires web research for news tasks when web_search is enabled", () => {
    const agent = mockAgent(["web_search"]);
    assert.equal(
      taskNeedsWebResearch("Find the latest AI news and give me a short summary.", agent),
      true
    );
  });

  it("builds a search query from the task instead of a hardcoded topic", () => {
    const agent = mockAgent(["web_search"], "Find new AI news every morning");
    const query = deriveWebSearchQuery(
      "Find the latest AI news and give me a short summary.",
      agent
    );
    assert.match(query, /AI news|latest/i);
  });
});
