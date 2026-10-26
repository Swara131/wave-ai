import { evaluateExpression } from "./evaluate-expression";
import type {
  DecisionAgentConfig,
  DecisionOutcome,
  DecisionRiskLevel,
  DecisionRule,
  DecisionUnit,
  DecisionUnitResult,
} from "./types";

export interface DecisionEvaluationResult {
  outcome: DecisionOutcome;
  matchedRuleId: string | null;
  reasoning: string;
  usedAiReasoning: boolean;
  riskLevel: DecisionRiskLevel;
  decisions: DecisionUnitResult[];
}

function rank(outcome: DecisionOutcome): number {
  if (outcome === "block") return 3;
  if (outcome === "review") return 2;
  return 1;
}

function combineOutcomes(outcomes: DecisionOutcome[]): DecisionOutcome {
  return outcomes.reduce((current, next) => (rank(next) > rank(current) ? next : current), "allow");
}

function unitsFromConfig(config: DecisionAgentConfig): DecisionUnit[] {
  if (config.decisions && config.decisions.length > 0) return config.decisions;
  return [
    {
      id: "primary",
      title: config.decisionQuestion || "Primary decision",
      description: config.decisionQuestion,
      inputs: config.inputs,
      rules: config.rules,
    },
  ];
}

export function inferDecisionRiskLevel(
  input: Record<string, unknown>,
  outcome: DecisionOutcome
): DecisionRiskLevel {
  const riskScore = Number(input.risk_score ?? input.risk);
  if (outcome === "block" || (Number.isFinite(riskScore) && riskScore >= 0.75)) return "high";
  if (outcome === "review" || (Number.isFinite(riskScore) && riskScore >= 0.4)) return "medium";
  return "low";
}

function evaluateRules(
  rules: DecisionRule[],
  input: Record<string, unknown>,
  threshold: number
): { outcome: DecisionOutcome; matchedRuleId: string | null; reasoning: string; missing: string[] } {
  const missing = new Set<string>();
  let hadNo = false;

  for (const rule of rules) {
    const result = evaluateExpression(rule.expression, input, { threshold });
    if (result === "missing") {
      for (const token of rule.expression.split(/\s+(?:AND|OR)\s+/i)) {
        const field = token.replace(/\s*(<=|>=|!=|==|=|<|>|contains)\s*.*$/i, "").trim();
        if (field && !/^otherwise$/i.test(field) && !(field in input && input[field] !== "")) {
          missing.add(field);
        }
      }
      continue;
    }
    if (result === "no") {
      hadNo = true;
      continue;
    }
    if (result === "match") {
      if (/^otherwise$/i.test(rule.expression) && missing.size > 0 && !hadNo) {
        return {
          outcome: "review",
          matchedRuleId: null,
          reasoning: `Missing facts: ${[...missing].join(", ")}. Wave will not invent values.`,
          missing: [...missing],
        };
      }
      return {
        outcome: rule.outcome,
        matchedRuleId: rule.id,
        reasoning: rule.label,
        missing: [],
      };
    }
  }

  if (missing.size > 0) {
    return {
      outcome: "review",
      matchedRuleId: null,
      reasoning: `Missing facts: ${[...missing].join(", ")}. Wave will not invent values.`,
      missing: [...missing],
    };
  }

  return {
    outcome: "review",
    matchedRuleId: null,
    reasoning: "No rule matched the provided facts. Defaulting to review instead of inventing an allow.",
    missing: [],
  };
}

/** Deterministic rule evaluation — no fake results. */
export function evaluateDecision(
  config: DecisionAgentConfig,
  input: Record<string, unknown>,
  options?: { threshold?: number }
): DecisionEvaluationResult {
  const threshold = options?.threshold ?? 5000;
  const units = unitsFromConfig(config);
  const decisions: DecisionUnitResult[] = units.map((unit) => {
    const evaluated = evaluateRules(unit.rules, input, threshold);
    return {
      id: unit.id,
      title: unit.title,
      outcome: evaluated.outcome,
      reasoning: evaluated.reasoning,
      matchedRuleId: evaluated.matchedRuleId,
      missingInputs: evaluated.missing,
    };
  });

  const outcome = combineOutcomes(decisions.map((item) => item.outcome));
  const matched = decisions.find((item) => item.matchedRuleId)?.matchedRuleId ?? null;
  const reasoning = decisions
    .map((item) => `${item.title}: ${item.outcome.toUpperCase()} — ${item.reasoning}`)
    .join("\n");

  return {
    outcome,
    matchedRuleId: matched,
    reasoning,
    usedAiReasoning: false,
    riskLevel: inferDecisionRiskLevel(input, outcome),
    decisions,
  };
}
