import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateZeltaProtection } from "@/lib/agents/protection/evaluator";
import { resolveActionType } from "@/lib/agents/runtime/tools/definitions";
import type { LoadedAgent } from "@/lib/agents/runtime/types";
import { recordSafetyDecisionAudit } from "./audit";
import { resolveAgentMission } from "./mission";
import { validateMissionAction } from "./mission-validation";
import { buildSafetyPolicyRulesForAgent, mapPolicyDecisionToSafety } from "./policies";
import { sanitizeActionParameters } from "./sanitize";
import { isReadOnlyTool } from "./mission";
import type {
  SafetyDecision,
  SafetyEvaluationContext,
  SafetyEvaluationResult,
} from "./types";

/**
 * Default when no policy matches:
 * - Read-only tools in the agent mission → ALLOW
 * - Everything else → REQUIRE_APPROVAL (fail-safe, matches gateway policy engine default)
 */
export function defaultSafetyDecisionForUnknownAction(params: {
  tool: string;
  missionAllowedTools: string[];
}): SafetyDecision {
  if (isReadOnlyTool(params.tool)) {
    return "ALLOW";
  }
  return "REQUIRE_APPROVAL";
}

function logSafetyDecision(
  phase: "evaluated" | "allowed" | "blocked" | "approval_required",
  params: {
    agentId: string;
    tool: string;
    action: string;
    decision: SafetyDecision;
    reason: string;
    policyId: string | null;
    runId?: string | null;
  }
): void {
  const label =
    phase === "evaluated"
      ? "action evaluated"
      : phase === "allowed"
        ? "action allowed"
        : phase === "blocked"
          ? "action blocked"
          : "approval required";

  console.info(`[safety] ${label}`, {
    agentId: params.agentId,
    tool: params.tool,
    action: params.action,
    decision: params.decision,
    policyId: params.policyId,
    runId: params.runId ?? null,
    reason: params.reason.slice(0, 200),
  });
}

export interface EvaluateActionParams {
  agent: LoadedAgent;
  action: string;
  tool: string;
  parameters: Record<string, unknown>;
  context?: {
    runId?: string | null;
    actionId?: string | null;
    source?: string;
  };
}

/** Pure safety evaluation — no database writes. Used by tests and the async gate wrapper. */
export function evaluateActionPure(params: EvaluateActionParams): SafetyEvaluationResult {
  const tool = params.tool.trim();
  const action = params.action.trim() || resolveActionType(tool);
  const sanitizedParameters = sanitizeActionParameters(params.parameters);
  const mission = resolveAgentMission(params.agent);

  // 1. Mission lock validation (server-side, no LLM)
  const missionValidation = validateMissionAction({
    agent: params.agent,
    tool,
    action,
    parameters: sanitizedParameters,
  });

  if (!missionValidation.allowed && !missionValidation.requiresApproval) {
    return {
      decision: "BLOCK",
      reason: missionValidation.reason,
      why: missionValidation.reason,
      policyId: missionValidation.violatedRule ?? "mission.lock",
      riskLevel: "critical",
      riskScore: 95,
      canExecute: false,
      plainEnglishSummary: missionValidation.reason,
      matchedPolicies: missionValidation.violatedRule
        ? [
            {
              policyId: missionValidation.violatedRule,
              name: "Mission lock",
              decision: "BLOCK",
              reason: missionValidation.reason,
            },
          ]
        : [],
      mission,
      sanitizedParameters,
    };
  }

  // 2. Policy validation
  const policyRules = buildSafetyPolicyRulesForAgent(params.agent);
  const protection = evaluateZeltaProtection({
    agent: params.agent,
    toolName: tool,
    actionType: action,
    payload: sanitizedParameters,
    policyRules,
  });

  let decision = mapPolicyDecisionToSafety(protection.decision);

  if (missionValidation.requiresApproval) {
    decision = "REQUIRE_APPROVAL";
  }

  if (protection.matchedPolicies.length === 0 && decision === "REQUIRE_APPROVAL") {
    decision = defaultSafetyDecisionForUnknownAction({
      tool,
      missionAllowedTools: mission.allowedTools,
    });
  }

  const primaryPolicy = protection.matchedPolicies[0];
  const policyId =
    missionValidation.violatedRule ?? primaryPolicy?.policyId ?? null;

  const missionBlocked = !missionValidation.allowed;
  const missionForcesApproval = Boolean(
    missionValidation.requiresApproval && missionValidation.violatedRule
  );
  let reason = protection.reason;
  if (missionBlocked || missionForcesApproval) {
    reason = missionValidation.reason;
  } else if (
    protection.matchedPolicies.length === 0 &&
    decision === "REQUIRE_APPROVAL" &&
    !protection.reason
  ) {
    reason =
      "No explicit policy matched this action. Wave requires approval before proceeding (safe default).";
  }

  return {
    decision,
    reason,
    why: protection.why,
    policyId,
    riskLevel: protection.riskLevel,
    riskScore: protection.riskScore,
    canExecute: decision === "ALLOW",
    plainEnglishSummary: protection.plainEnglishSummary,
    matchedPolicies: [
      ...(missionValidation.violatedRule
        ? [
            {
              policyId: missionValidation.violatedRule,
              name: "Mission lock",
              decision: missionValidation.requiresApproval
                ? ("REQUIRE_APPROVAL" as SafetyDecision)
                : ("BLOCK" as SafetyDecision),
              reason: missionValidation.reason,
            },
          ]
        : []),
      ...protection.matchedPolicies.map((policy) => ({
        policyId: policy.policyId,
        name: policy.name,
        decision: mapPolicyDecisionToSafety(policy.decision),
        reason: policy.reason,
      })),
    ],
    mission,
    sanitizedParameters,
  };
}

/** Central Wave Safety Gate — evaluates an action before tool execution. */
export function evaluateAction(params: EvaluateActionParams): SafetyEvaluationResult {
  const result = evaluateActionPure(params);

  logSafetyDecision("evaluated", {
    agentId: params.agent.record.id,
    tool: params.tool,
    action: params.action,
    decision: result.decision,
    reason: result.reason,
    policyId: result.policyId,
    runId: params.context?.runId,
  });

  if (result.decision === "ALLOW") {
    logSafetyDecision("allowed", {
      agentId: params.agent.record.id,
      tool: params.tool,
      action: params.action,
      decision: result.decision,
      reason: result.reason,
      policyId: result.policyId,
      runId: params.context?.runId,
    });
  } else if (result.decision === "BLOCK") {
    logSafetyDecision("blocked", {
      agentId: params.agent.record.id,
      tool: params.tool,
      action: params.action,
      decision: result.decision,
      reason: result.reason,
      policyId: result.policyId,
      runId: params.context?.runId,
    });
  } else {
    logSafetyDecision("approval_required", {
      agentId: params.agent.record.id,
      tool: params.tool,
      action: params.action,
      decision: result.decision,
      reason: result.reason,
      policyId: result.policyId,
      runId: params.context?.runId,
    });
  }

  return result;
}

/** Async wrapper that records a safety audit event (used by the runtime control layer). */
export async function evaluateActionWithAudit(
  admin: SupabaseClient,
  params: EvaluateActionParams & { organizationId: string; proposalId?: string | null }
): Promise<SafetyEvaluationResult> {
  const context: SafetyEvaluationContext = {
    agent: params.agent,
    tool: params.tool,
    action: params.action,
    parameters: params.parameters,
    runId: params.context?.runId,
    actionId: params.context?.actionId,
    source: params.context?.source,
  };

  const result = evaluateAction(params);

  recordSafetyDecisionAudit(admin, context, result, {
    organizationId: params.organizationId,
    proposalId: params.proposalId,
  });

  return result;
}
