import type { PendingApproval, ApprovalPriority } from "@/lib/approval-types";
import type { RiskSeverity } from "@/lib/risk-types";
import type { MatchedPolicyReason } from "@/lib/gateway/policy/types";
import { policyDecisionFromDb } from "@/lib/gateway/policy/types";
import type { StoredRiskReasons } from "./enrichment";
import { extractMatchedPoliciesFromRiskReasons } from "./enrichment";
import { buildRiskScoreBreakdown } from "@/lib/approvals/risk-score-breakdown";
import { mapShadowRiskDisplay } from "@/lib/ui/shadow-risk-display";
import type { ActionProposalRow } from "./repository";
import { sanitizeActionParameters } from "@/lib/safety/sanitize";

const SEVERITIES = new Set<RiskSeverity>(["critical", "high", "medium", "low"]);

function normalizeSeverity(value: string | null | undefined): RiskSeverity {
  const lower = value?.toLowerCase();
  return SEVERITIES.has(lower as RiskSeverity) ? (lower as RiskSeverity) : "medium";
}

function severityToPriority(severity: RiskSeverity): ApprovalPriority {
  switch (severity) {
    case "critical":
      return "p1";
    case "high":
      return "p2";
    case "medium":
      return "p3";
    case "low":
      return "p4";
    default:
      return "p3";
  }
}

function parseStoredRiskReasons(value: unknown): StoredRiskReasons {
  if (typeof value === "object" && value !== null && "matchedPolicies" in value) {
    return value as StoredRiskReasons;
  }

  return {
    matchedPolicies: extractMatchedPoliciesFromRiskReasons(value),
  };
}

function buildTitle(row: ActionProposalRow): string {
  const payload = row.action_payload ?? {};
  const agentName =
    typeof payload.agentName === "string" && payload.agentName.trim()
      ? payload.agentName.trim()
      : null;
  if (row.tool_name === "activate_agent") {
    return agentName ? `Activate ${agentName}` : "Activate agent";
  }
  if (agentName) {
    return `${agentName}: ${row.tool_name} — ${row.action_type}`;
  }
  return `${row.tool_name} — ${row.action_type}`;
}

function maskIdentifier(value: string): string {
  if (value.length <= 6) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}*****`;
}

function sanitizeDisplayPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key.startsWith("_zelta")) continue;
    if (typeof value === "string" && /id$/i.test(key) && value.length > 6) {
      cleaned[key] = maskIdentifier(value);
      continue;
    }
    cleaned[key] = value;
  }
  return sanitizeActionParameters(cleaned);
}

export function mapReviewProposalToPendingApproval(
  row: ActionProposalRow
): PendingApproval {
  const riskSeverity = normalizeSeverity(row.risk_level);
  const stored = parseStoredRiskReasons(row.risk_reasons);
  const matchedPolicies: MatchedPolicyReason[] = stored.matchedPolicies ?? [];
  const aiRiskReasons = stored.ai?.riskReasons ?? [];
  const reviewerAssistance = stored.ai?.reviewerAssistance ?? "";
  const shadowRisk = mapShadowRiskDisplay(row.risk_reasons, row.policy_decision);
  const riskScoreBreakdown =
    buildRiskScoreBreakdown({
      riskScore: row.risk_score,
      riskSeverity,
      riskReasons: row.risk_reasons,
      matchedPolicies,
      aiRiskReasons,
      shadowReasons: shadowRisk.reasons,
      shadowSignalLabels: shadowRisk.signalLabels,
    }) ?? undefined;

  return {
    id: row.id,
    title: buildTitle(row),
    agentId:
      typeof row.action_payload?.agentName === "string" && row.action_payload.agentName.trim()
        ? row.action_payload.agentName.trim()
        : row.agent_id,
    riskSeverity,
    priority: severityToPriority(riskSeverity),
    aiExplanation:
      row.plain_english_summary?.trim() ||
      "Awaiting AI explanation for this proposed agent action.",
    businessJustification:
      matchedPolicies.map((policy) => `${policy.name}: ${policy.reason}`).join(" ") ||
      "Policy engine routed this action for human review.",
    affectedSystems: matchedPolicies.map(
      (policy) => `${policy.name} (${policy.decision})`
    ),
    affectedUsers: aiRiskReasons.length > 0 ? aiRiskReasons : ["Pending reviewer assessment"],
    complianceImpact:
      stored.ai?.riskSignals?.join("; ") ||
      "Review matched policies and AI risk signals before approving.",
    recommendedAction:
      reviewerAssistance ||
      "Approve only if business justification and payload match expected agent behavior.",
    confidenceScore: row.risk_score,
    timeline: [
      {
        id: `tl-${row.id}-proposed`,
        title: "Action Proposed",
        description: `Gateway received ${row.tool_name} from ${row.agent_id}`,
        timestamp: row.created_at,
        actor: row.agent_id,
        type: "created",
      },
      {
        id: `tl-${row.id}-review`,
        title: "Review Required",
        description: "Deterministic policy engine requires human authorization",
        timestamp: row.decided_at ?? row.created_at,
        actor: "Policy Engine",
        type: "assigned",
      },
    ],
    history: [],
    submittedAt: row.created_at,
    slaDeadline: row.review_expires_at ?? row.expires_at,
    assignee: "Unassigned",
    requester: row.agent_id,
    agentSlug: row.agent_id,
    source: "gateway",
    toolName: row.tool_name,
    actionType: row.action_type,
    actionPayload: sanitizeDisplayPayload(row.action_payload ?? {}),
    actionHash: row.action_hash,
    matchedPolicies,
    aiRiskReasons,
    riskScore: row.risk_score,
    riskScoreBreakdown,
    gatewayDecision: policyDecisionFromDb(row.policy_decision) ?? undefined,
    shadowRisk,
  };
}
