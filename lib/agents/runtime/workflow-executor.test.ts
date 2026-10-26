import assert from "node:assert/strict";
import test from "node:test";
import { generateWorkflowFromInterpretation } from "@/lib/agents/workflow/generate-from-interpretation";
import { syncWorkflowToAgentConfig } from "@/lib/agents/workflow/sync-to-agent";
import { agentHasPersistedWorkflow, toolInputForNode } from "./workflow-executor";
import { isAiWorkflowNode } from "./workflow-ai-step";
import type { AgentInterpretation } from "@/lib/agents/builder-types";
import type { LoadedAgent } from "./types";

const interpretation: AgentInterpretation = {
  displayName: "Research Agent",
  goal: "Find the latest research every morning and email a summary",
  instructions: "Search, summarize, email.",
  scheduleSummary: "Every morning at 9:00 AM",
  schedule: { when: "daily", time: "09:00", triggerType: "schedule" },
  timezone: "Asia/Kolkata",
  capabilityIds: ["web_search", "email"],
  capabilities: [],
  tools: ["web_search", "send_email"],
  protectionSummary: "Wave checks important actions",
  triggerType: "schedule",
  suggestedThreshold: 5000,
  originalDescription: "Find research every morning and email me",
  deliveryMode: "email",
};

test("persisted news-style workflow includes search then email and syncs delivery", () => {
  const graph = generateWorkflowFromInterpretation(interpretation);
  const tools = graph.nodes.map((node) => node.config.toolName).filter(Boolean);
  assert.ok(tools.includes("web_search"));
  assert.ok(tools.includes("send_email"));
  const searchIndex = graph.nodes.findIndex((node) => node.config.toolName === "web_search");
  const emailIndex = graph.nodes.findIndex((node) => node.config.toolName === "send_email");
  assert.ok(searchIndex >= 0 && emailIndex > searchIndex);

  const config = syncWorkflowToAgentConfig(graph);
  assert.equal(config.deliveryMode, "email");
});

test("agentHasPersistedWorkflow is true when safety_settings stores a graph", () => {
  const graph = generateWorkflowFromInterpretation(interpretation);
  const agent = {
    record: {
      safetySettings: {
        workflowState: { published: graph, draft: null, lastVerifiedAt: null, verificationStatus: "valid" },
      },
    },
  } as LoadedAgent;
  assert.equal(agentHasPersistedWorkflow(agent), true);
});

test("generated AI steps stay executable even if category is missing from storage", () => {
  const graph = generateWorkflowFromInterpretation(interpretation);
  const ai = graph.nodes.find((node) => node.type.startsWith("ai_"));
  assert.ok(ai);
  const stored = { ...ai, category: undefined as unknown as typeof ai.category };
  assert.equal(isAiWorkflowNode(stored), true);
});

test("read_document workflow nodes ask for the latest file instead of dumping setup answers", () => {
  const input = toolInputForNode({
    node: {
      id: "read-1",
      type: "tool",
      category: "tool",
      name: "Read document",
      description: "",
      config: { toolName: "read_document" },
      status: "valid",
      position: 1,
    },
    agent: {
      record: { setupAnswers: { company: "Acme" } },
    } as unknown as LoadedAgent,
    task: "Summarize the file",
    summary: "",
  });
  assert.deepEqual(input, { documentId: "latest" });
});
