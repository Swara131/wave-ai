import { evaluatePolicy } from "@/lib/gateway/policy/engine";
import { buildPolicyEvaluationContext } from "@/lib/gateway/policy/context";
import type { PolicyDecisionOutcome } from "@/lib/gateway/policy/types";
import {
  buildRiskContext,
  extractDeterministicRiskSignals,
} from "@/lib/gateway/risk/signals";
import type { RiskSeverity } from "@/lib/risk-types";
import { getToolDefinition } from "../tools/catalog";
import type { LoadedAgent } from "../runtime/types";
import {
  buildAgentSafetyPolicyRules,
  getZeltaProtectionPolicies,
} from "./rules";
import { buildProtectionSummary } from "./summaries";
import type { ProtectionEvaluationResult } from "./types";

const DECISION_RANK: Record<PolicyDecisionOutcome, number> = {
  ALLOW: 1,
  REVIEW: 2,
  BLOCK: 3,
};

function maxDecision(
  a: PolicyDecisionOutcome,
  b: PolicyDecisionOutcome
): PolicyDecisionOutcome {
  return DECISION_RANK[b] > DECISION_RANK[a] ? b : a;
}

function deriveRiskLevel(
  decision: PolicyDecisionOutcome,
  signals: ReturnType<typeof extractDeterministicRiskSignals>
): RiskSeverity {
  if (decision === "BLOCK") return "critical";

  const rank = { high: 3, medium: 2, low: 1 } as const;
  let max: keyof typeof rank = "low";
  for (const signal of signals) {
    if (rank[signal.severity] > rank[max]) max = signal.severity;
  }
  if (decision === "REVIEW" && max === "low") return "medium";
  return max;
}

function deriveRiskScore(
  signals: ReturnType<typeof extractDeterministicRiskSignals>,
  decision: PolicyDecisionOutcome
): number {
  const weights = { high: 78, medium: 52, low: 24 };
  let score = 20;
  for (const signal of signals) {
    score = Math.max(score, weights[signal.severity]);
  }
  if (decision === "REVIEW") score = Math.max(score, 65);
  if (decision === "BLOCK") score = Math.max(score, 92);
  return Math.min(score, 100);
}

function applyToolAndSignalOverrides(params: {
  toolName: string;
  payload: Record<string, unknown>;
  decision: PolicyDecisionOutcome;
  matchedCount: number;
  signals: ReturnType<typeof extractDeterministicRiskSignals>;
}): PolicyDecisionOutcome {
  let decision = params.decision;

  const tool = getToolDefinition(params.toolName);
  if (
    (tool?.riskLevel === "critical" || tool?.riskLevel === "high") &&
    decision === "ALLOW"
  ) {
    decision = "REVIEW";
  }

  if (params.toolName === "http_request") {
    const method =
      typeof params.payload.method === "string"
        ? params.payload.method.trim().toUpperCase()
        : "GET";
    if (!["GET", "HEAD"].includes(method)) {
      decision = maxDecision(decision, "REVIEW");
    }
  }

  if (decision === "ALLOW") {
    const hasHighSignal = params.signals.some((signal) => {
      if (signal.severity !== "high") return false;
      if (params.matchedCount > 0 && signal.code === "financial.amount.present") {
        return false;
      }
      return true;
    });
    if (hasHighSignal) {
      decision = "REVIEW";
    }
  }

  if (params.signals.some((signal) => signal.code === "destructive_operation")) {
    const production = params.signals.some(
      (signal) => signal.code === "production_target"
    );
    decision = maxDecision(decision, production ? "BLOCK" : "REVIEW");
  }

  if (params.matchedCount === 0 && decision === "REVIEW") {
    const readOnlyTools = new Set([
      "web_search",
      "read_document",
      "query_supabase",
      "google_sheets",
      "x_search",
      "fetch_url",
    ]);
    if (readOnlyTools.has(params.toolName)) {
      decision = "ALLOW";
    }
  }

  return decision;
}

export function evaluateZeltaProtection(params: {
  agent: LoadedAgent;
  toolName: string;
  actionType: string;
  payload: Record<string, unknown>;
  /** When provided, replaces the default assembled platform + agent rule set. */
  policyRules?: import("@/lib/gateway/policy/types").PolicyRuleDefinition[];
}): ProtectionEvaluationResult {
  const safety = params.agent.record.safetySettings ?? {};
  const thresholdInr =
    safety.thresholdInr ?? params.agent.record.suggestedThreshold ?? 5000;

  const rules =
    params.policyRules ??
    [
      ...getZeltaProtectionPolicies(),
      ...buildAgentSafetyPolicyRules(safety, thresholdInr),
    ];

  const policyEvaluation = evaluatePolicy({
    toolName: params.toolName,
    actionType: params.actionType,
    payload: params.payload,
    rules,
  });

  const riskContext = buildRiskContext({
    agentId: params.agent.gatewayAgentId,
    toolName: params.toolName,
    actionType: params.actionType,
    payload: params.payload,
  });
  const riskSignals = extractDeterministicRiskSignals(riskContext);

  let decision = policyEvaluation.decision;

  decision = applyToolAndSignalOverrides({
    toolName: params.toolName,
    payload: params.payload,
    decision,
    matchedCount: policyEvaluation.matchedPolicies.length,
    signals: riskSignals,
  });

  const riskLevel = deriveRiskLevel(decision, riskSignals);
  const riskScore = deriveRiskScore(riskSignals, decision);

  const primaryReason =
    policyEvaluation.matchedPolicies[0]?.reason ??
    riskSignals[0]?.description ??
    (decision === "ALLOW"
      ? "Wave Protection allows this action."
      : decision === "BLOCK"
        ? "Wave Protection blocked this action."
        : "This action needs your approval before it can run.");

  const { summary, why } = buildProtectionSummary({
    agentName: params.agent.record.name,
    toolName: params.toolName,
    payload: params.payload,
    decision,
    reason: primaryReason,
    riskLevel,
  });

  const policyContext = buildPolicyEvaluationContext({
    toolName: params.toolName,
    actionType: params.actionType,
    payload: params.payload,
  });

  return {
    decision,
    reason: primaryReason,
    why,
    riskLevel,
    riskScore,
    matchedPolicies: policyEvaluation.matchedPolicies,
    riskSignals,
    plainEnglishSummary: summary,
    actionDetails: {
      toolName: params.toolName,
      actionType: params.actionType,
      recipientCount: policyContext.dataExportSize,
      amount: policyContext.amount,
      currency: policyContext.currency,
      destructiveOperation: policyContext.destructiveOperation,
    },
  };
}
