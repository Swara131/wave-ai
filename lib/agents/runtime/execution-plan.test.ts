import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveExecutableTaskFromSetup,
  destinationEmailFromAgent,
  workflowPlanFromGraph,
} from "./execution-plan";
import { generateWorkflowFromPromptFallback } from "@/lib/agents/workflow/prompt-heuristics";
import { interpretAgentRequest } from "@/lib/agents/interpret-agent-request";
import { inferDeliveryModeFromText } from "@/lib/agents/delivery/infer-delivery";

test("deriveExecutableTaskFromSetup does not dump saved configuration as the task", () => {
  const task = deriveExecutableTaskFromSetup({
    goal: "Find the latest AI news every morning and send a short summary by email.",
    setupAnswers: {
      email: "user@example.com",
      schedule: JSON.stringify({ when: "daily", time: "09:00", timezone: "Asia/Kolkata" }),
    },
  });

  assert.doesNotMatch(task, /user@example.com/);
  assert.doesNotMatch(task, /Use this saved configuration/i);
  assert.doesNotMatch(task, /create an agent that/i);
  assert.match(task, /AI news/i);
});

test("destinationEmailFromAgent reads setup answers", () => {
  const email = destinationEmailFromAgent({
    safetySettings: {
      setupAnswers: { email: "ops@example.com" },
    },
  });
  assert.equal(email, "ops@example.com");
});

test("workflow plan follows generated nodes including search and email", () => {
  const graph = generateWorkflowFromPromptFallback(
    "Find the latest AI news every morning and email me a short summary"
  );
  const plan = workflowPlanFromGraph(graph);
  assert.ok(plan.length >= 3);
  const names = plan.map((step) => `${step.name} ${step.toolName ?? ""}`.toLowerCase());
  assert.ok(names.some((name) => name.includes("search") || name.includes("research")));
  assert.ok(names.some((name) => name.includes("email") || name.includes("send_email")));
});

test("prompt-created news agent gets research, schedule, and email capabilities", async () => {
  const interpretation = await interpretAgentRequest(
    "Find the latest AI news every morning and send me a short summary by email."
  );
  assert.ok(interpretation.tools.includes("web_search"));
  assert.ok(interpretation.tools.includes("send_email"));
  assert.equal(interpretation.triggerType, "schedule");
  assert.equal(inferDeliveryModeFromText(interpretation.originalDescription), "email");
});
