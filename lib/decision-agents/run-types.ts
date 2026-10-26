export type DecisionRunStatus = "running" | "completed" | "failed";

export type DecisionAgentRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "unable_to_verify";

export type SourceKind = "official" | "exchange" | "company" | "media" | "unknown";

export interface DecisionRunSource {
  title: string;
  url: string;
  name: string;
  snippet: string;
  kind: SourceKind;
  publicationDate: string | null;
  retrievedAt: string;
}

export interface DecisionAgentFinding {
  id: string;
  name: string;
  role: string;
  status: DecisionAgentRunStatus;
  summary: string;
  evidence: string[];
  sources: DecisionRunSource[];
  dates: string[];
  assumptions: string[];
  uncertainties: string[];
  verifiedFacts: string[];
  estimates: string[];
  unknowns: string[];
  risks: string[];
  counterarguments: string[];
  conflicts: string[];
  missingInformation: string[];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface DecisionRunReport {
  title: string;
  executedAt: string;
  overall: "review" | "block" | "insufficient";
  overallExplanation: string;
  evidenceQuality: "high" | "medium" | "low" | "insufficient";
  ipoStatus: string | null;
  ipoStatusVerified: boolean;
  financialAnalysis: string | null;
  nextSteps: string[];
  agents: DecisionAgentFinding[];
  insufficientVerifiedInformation: boolean;
}

export interface DecisionAgentRunRecord {
  id: string;
  userId: string;
  organizationId: string;
  decisionAgentId: string | null;
  idempotencyKey: string | null;
  title: string;
  purpose: string;
  input: Record<string, unknown>;
  config: Record<string, unknown>;
  status: DecisionRunStatus;
  report: DecisionRunReport;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionAgentSpec {
  id: string;
  name: string;
  role: string;
  searchQuery: string;
}
