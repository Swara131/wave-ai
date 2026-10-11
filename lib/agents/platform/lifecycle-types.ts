/** Agent platform lifecycle — persisted in agents.safety_settings.platformLifecycle */

export type PlatformLifecycleStage =
  | "draft"
  | "building"
  | "testing"
  | "verified"
  | "protected"
  | "deploying"
  | "deployed"
  | "paused"
  | "failed"
  | "needs_attention";

export type PlatformCheckStatus = "not_run" | "pass" | "fail" | "needs_attention";

export interface PlatformCheckResult {
  id: string;
  label: string;
  status: PlatformCheckStatus;
  message?: string;
  fixHref?: string;
  fixLabel?: string;
  checkedAt?: string | null;
}

export interface AgentTestCaseRecord {
  id: string;
  input: string;
  expectedBehavior: string;
  actualResult?: string | null;
  status: "not_run" | "pass" | "fail" | "needs_attention";
  lastRunAt?: string | null;
  aiGeneratedExpectation?: boolean;
}

export interface AgentDeploymentRecord {
  environment: "production";
  version: number;
  previousVersion?: number | null;
  state: "idle" | "preparing" | "validating" | "publishing" | "starting_runtime" | "health_check" | "deployed" | "failed";
  deployedAt?: string | null;
  errorMessage?: string | null;
  hasUnpublishedDraft?: boolean;
  draftVersion?: number | null;
}

export interface AgentPlatformLifecycle {
  stage: PlatformLifecycleStage;
  checks: PlatformCheckResult[];
  testCases: AgentTestCaseRecord[];
  lastVerifiedAt?: string | null;
  lastTestedAt?: string | null;
  deployment: AgentDeploymentRecord;
  updatedAt: string;
}

export const DEFAULT_PLATFORM_CHECKS: Omit<PlatformCheckResult, "checkedAt">[] = [
  { id: "configuration", label: "Configuration", status: "not_run" },
  { id: "workflow", label: "Workflow", status: "not_run" },
  { id: "tools", label: "Tools", status: "not_run" },
  { id: "connections", label: "Connections", status: "not_run" },
  { id: "database", label: "Database", status: "not_run" },
  { id: "execution", label: "Execution", status: "not_run" },
  { id: "output", label: "Output", status: "not_run" },
  { id: "safety", label: "Safety", status: "not_run" },
  { id: "notifications", label: "Notifications", status: "not_run" },
];

export function createDefaultPlatformLifecycle(): AgentPlatformLifecycle {
  return {
    stage: "draft",
    checks: DEFAULT_PLATFORM_CHECKS.map((check) => ({ ...check, checkedAt: null })),
    testCases: [],
    deployment: {
      environment: "production",
      version: 0,
      state: "idle",
      hasUnpublishedDraft: false,
    },
    updatedAt: new Date().toISOString(),
  };
}
