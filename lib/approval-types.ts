import type { RiskSeverity } from "./risk-types";
import type { RiskScoreBreakdownView } from "@/lib/approvals/risk-score-breakdown";
import type { ShadowRiskDisplayView } from "@/lib/ui/shadow-risk-display";

export type ApprovalPriority = "p1" | "p2" | "p3" | "p4";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "changes_requested" | "escalated";

export interface TimelineEvent {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  actor: string;
  type: "created" | "analyzed" | "assigned" | "comment" | "escalated" | "action";
}

export interface HistoryEntry {
  id: string;
  action: string;
  actor: string;
  timestamp: string;
  note?: string;
}

export interface PendingApproval {
  id: string;
  title: string;
  agentId: string;
  riskSeverity: RiskSeverity;
  priority: ApprovalPriority;
  aiExplanation: string;
  businessJustification: string;
  affectedSystems: string[];
  affectedUsers: string[];
  complianceImpact: string;
  recommendedAction: string;
  confidenceScore: number;
  timeline: TimelineEvent[];
  history: HistoryEntry[];
  submittedAt: string;
  slaDeadline: string;
  assignee: string;
  requester: string;
  /** Gateway proposal fields (pre-execution review queue). */
  source?: "gateway" | "retrospective";
  /** Gateway agent slug used for /agents/[agentId] routes. */
  agentSlug?: string;
  toolName?: string;
  actionType?: string;
  actionPayload?: Record<string, unknown>;
  actionHash?: string;
  matchedPolicies?: Array<{
    policyId: string;
    name: string;
    decision: "ALLOW" | "REVIEW" | "BLOCK";
    reason: string;
  }>;
  aiRiskReasons?: string[];
  riskScore?: number;
  /** Explainable AI risk score breakdown for approval UI. */
  riskScoreBreakdown?: RiskScoreBreakdownView;
  /** Authoritative gateway policy decision. */
  gatewayDecision?: "ALLOW" | "REVIEW" | "BLOCK";
  /** Observational shadow risk assessment for display. */
  shadowRisk?: ShadowRiskDisplayView;
}
