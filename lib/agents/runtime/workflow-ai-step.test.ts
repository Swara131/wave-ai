import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateExecutionCheck,
  evaluateOutputCheck,
} from "@/lib/agents/platform/evaluate-run-checks";
import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";
import {
  completeAiWorkflowStep,
  fallbackWorkflowSummary,
  isAiWorkflowNode,
} from "./workflow-ai-step";

describe("completeAiWorkflowStep", () => {
  it("keeps an existing summary instead of inventing a new one", async () => {
    const result = await completeAiWorkflowStep({
      task: "Decorate a venue",
      agent: {
        name: "Custom Agent",
        goal: "Turn a venue photo into concepts",
        description: "Design helper",
        instructions: "Use the photo",
        safetySettings: {},
      },
      existingSummary: "Retrieved page title and a real source URL.",
      deps: {
        groqConfigured: false,
        completeJson: async () => {
          throw new Error("should not call the model");
        },
      },
    });
    assert.equal(result.summary, "Retrieved page title and a real source URL.");
  });

  it("treats AI node types as AI even when category is missing", () => {
    assert.equal(isAiWorkflowNode({ type: "ai_generation" }), true);
    assert.equal(isAiWorkflowNode({ category: "ai", type: "tool" }), true);
    assert.equal(isAiWorkflowNode({ type: "tool", category: "tool" }), false);
  });

  it("returns an honest result when Groq is not configured instead of failing empty", async () => {
    const result = await completeAiWorkflowStep({
      task: "Decorate a venue",
      agent: {
        name: "Custom Agent",
        goal: "Turn a venue photo into concepts",
        description: "Design helper",
        instructions: "Use the photo",
        safetySettings: {},
      },
      deps: {
        groqConfigured: false,
        completeJson: async () => {
          throw new Error("should not call the model");
        },
      },
    });
    assert.equal(result.summary, fallbackWorkflowSummary("Custom Agent"));
    assert.match(result.summary, /will not invent/);
    assert.doesNotMatch(result.summary, /Decorate a venue/);
  });

  it("uses the vision result when a photo is provided and does not invent prices", async () => {
    const result = await completeAiWorkflowStep({
      task: "Create decoration concepts",
      agent: {
        name: "Custom Agent",
        goal: "Turn a venue photo into concepts",
        description: "Design helper",
        instructions: "Use the photo",
        safetySettings: {},
      },
      sourceImage: {
        mimeType: "image/jpeg",
        base64: "aaaa",
        filename: "hall.jpg",
      },
      deps: {
        groqConfigured: true,
        completeJson: async () => {
          throw new Error("text model should not run");
        },
        completeVisionJson: async () => ({
          summary:
            "The photo shows an empty hall with beige walls. Suggested lighting: warm string lights along the existing beams. Prices are not included because none were provided.",
          concepts: [
            {
              title: "Warm lights",
              prompt: "Keep this hall. Add string lights on the existing beams.",
            },
          ],
        }),
        generateImages: async () => [
          { title: "Warm lights", dataUrl: "data:image/png;base64,abc" },
        ],
      },
    });
    assert.match(result.summary, /empty hall/);
    assert.doesNotMatch(result.summary, /\$\d{2,}/);
    assert.equal(result.conceptImages[0]?.title, "Warm lights");
    assert.match(result.conceptPrompts[0]?.prompt ?? "", /Avoid:/);
  });

  it("uses markdown from vision when JSON is missing", async () => {
    const result = await completeAiWorkflowStep({
      task: "Create decoration concepts",
      agent: {
        name: "Custom Agent",
        goal: "Turn a venue photo into concepts",
        description: "Design helper",
        instructions: "Use the photo",
        safetySettings: {},
      },
      sourceImage: {
        mimeType: "image/jpeg",
        base64: "aaaa",
        filename: "beach.jpg",
      },
      deps: {
        groqConfigured: true,
        completeJson: async () => ({}),
        completeVisionJson: async () => ({
          summary:
            "A sandy beach with blue water and a clear sky. Evening lanterns along the shoreline would fit this scene. No prices are given.",
        }),
      },
    });
    assert.match(result.summary, /sandy beach/);
    assert.equal(result.conceptPrompts.length, 1);
  });

  it("uses the model result and does not require a prior tool", async () => {
    const result = await completeAiWorkflowStep({
      task: "Run a live test of the design assistant",
      agent: {
        name: "Custom Agent",
        goal: "Turn a venue photo into concepts",
        description: "Design helper",
        instructions: "Use the photo",
        safetySettings: {},
      },
      deps: {
        groqConfigured: true,
        completeJson: async () => ({
          summary:
            "No venue photo or source URL was provided for this test. Wave cannot invent decorations or prices.",
          missingInputs: ["venue photo"],
        }),
      },
    });
    assert.match(result.summary, /No venue photo/);
    assert.doesNotMatch(result.summary, /\$\d{2,}/);
  });

  it("counts an honest missing-input summary as a completed test result", () => {
    const task = "Turn a venue photo into decoration concepts and email me.";
    const summary = fallbackWorkflowSummary("Custom Agent");
    const agent = {
      name: "Custom Agent",
      slug: "custom-agent-5",
      tools: ["send_email"],
      safetySettings: {},
    } as BuilderAgentRecord;
    assert.equal(
      evaluateExecutionCheck({ status: "completed", summary, task }).status,
      "pass"
    );
    assert.equal(
      evaluateOutputCheck({ agent, status: "completed", summary, task }).status,
      "pass"
    );
  });
});
