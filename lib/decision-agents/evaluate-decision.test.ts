import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateDecision } from "./evaluate-decision";
import { generateDecisionAgentFromPrompt } from "./generate-from-prompt";
import type { DecisionAgentConfig } from "./types";

const baseConfig: DecisionAgentConfig = {
  decisionQuestion: "Approve refund?",
  inputs: ["refund_amount", "customer_eligible", "risk_score"],
  rules: [
    {
      id: "allow-small",
      label: "Small eligible refund",
      expression: "refund_amount <= threshold AND customer_eligible AND risk_score < 0.5",
      outcome: "allow",
    },
    {
      id: "review-large",
      label: "Large refund",
      expression: "otherwise",
      outcome: "review",
    },
  ],
  actions: ["process_refund", "notify_customer"],
  approvalWhen: "High amount or elevated risk",
  workflow: [],
  aiReasoningEnabled: false,
};

describe("evaluateDecision", () => {
  it("allows small eligible low-risk refunds", () => {
    const result = evaluateDecision(baseConfig, {
      refund_amount: 2000,
      customer_eligible: true,
      risk_score: 0.2,
    });
    assert.equal(result.outcome, "allow");
    assert.equal(result.matchedRuleId, "allow-small");
  });

  it("routes large refunds to review", () => {
    const result = evaluateDecision(baseConfig, {
      refund_amount: 75000,
      customer_eligible: true,
      risk_score: 0.8,
    });
    assert.equal(result.outcome, "review");
  });

  it("does not invent an allow when required facts are missing", () => {
    const result = evaluateDecision(baseConfig, {});
    assert.equal(result.outcome, "review");
    assert.match(result.reasoning, /missing|invent/i);
  });
});

describe("generateDecisionAgentFromPrompt", () => {
  it("builds multiple real decisions for an IPO research prompt instead of fake refund fields", () => {
    const preview = generateDecisionAgentFromPrompt({
      prompt:
        'Build a multi-agent AI assistant called "Jio IPO Research & Decision Assistant" which help Indian retail investors understand the Jio Platforms IPO using verified information without blindly recommending that users apply.',
    });
    assert.equal(preview.name, "Jio IPO Research & Decision Assistant");
    assert.ok((preview.config.decisions?.length ?? 0) >= 3);
    assert.ok(!preview.config.inputs.includes("customer_eligible"));
    assert.ok(!preview.config.inputs.includes("order_age"));
    assert.ok(preview.config.workflow.some((node) => node.type === "decision"));
    assert.ok((preview.config.edges?.length ?? 0) >= 3);
    assert.ok(preview.config.workflow.every((node) => typeof node.x === "number"));
  });

  it("evaluates each IPO decision from provided facts only", () => {
    const preview = generateDecisionAgentFromPrompt({
      prompt: "Help investors understand an IPO using official filings. Do not blindly recommend applying.",
    });
    const result = evaluateDecision(preview.config, {
      information_source: "SEBI draft red herring prospectus",
      investor_profile: "Retail investor, first IPO",
      risk_tolerance: "low",
      claim_summary: "Should I apply to this IPO?",
    });
    assert.equal(result.decisions.length >= 3, true);
    const action = result.decisions.find((item) => item.id === "recommend_action");
    assert.ok(action);
    assert.notEqual(action?.outcome, "block");
  });
});
