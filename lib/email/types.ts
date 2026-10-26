export type EmailTemplateType =
  | "approval_requested"
  | "approval_approved"
  | "approval_rejected"
  | "critical_risk_detected"
  | "gateway_review_requested"
  | "agent_result";

export type EmailTemplatePayload = {
  approval_requested: {
    approvalId: string;
    title: string;
    severity: string;
    agentId: string;
    requiredApprovals: number;
    slaDeadline: string;
    aiExplanation: string;
    recipientName: string;
  };
  approval_approved: {
    approvalId: string;
    title: string;
    severity: string;
    agentId: string;
    actorName?: string;
    note?: string;
    recipientName: string;
  };
  approval_rejected: {
    approvalId: string;
    title: string;
    severity: string;
    agentId: string;
    actorName?: string;
    note?: string;
    recipientName: string;
  };
  critical_risk_detected: {
    riskAnalysisId: string;
    title: string;
    severity: string;
    overallScore: number;
    explanation: string;
    suggestedAction: string;
    recipientName: string;
  };
  gateway_review_requested: {
    proposalId: string;
    agentId: string;
    toolName: string;
    actionType: string;
    plainEnglishSummary: string;
    riskLevel: string;
    riskScore: number;
    riskReasons: string[];
    reviewDeadline: string;
    approvalsUrl: string;
    approveUrl: string;
    rejectUrl: string;
    recipientName: string;
  };
  agent_result: {
    agentName: string;
    agentSlug: string;
    summary: string;
    sources?: string[];
    recipientName: string;
    runMode: string;
    runAt: string;
    timezone?: string;
    runId?: string;
    executionStatus?: string;
    templateName?: string;
  };
};

export interface RenderedEmail {
  subject: string;
  preview: string;
  html: string;
}
