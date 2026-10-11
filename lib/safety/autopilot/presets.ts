import type {
  AgentApprovalRuleRecord,
  AgentExecutionLimitRecord,
  DataProtectionSettings,
  ProtectionMode,
  ToolPermissionLevel,
} from "./types";
import type { AutopilotToolDefinition } from "./tools-catalog";

export interface ProtectionPresetDefinition {
  mode: ProtectionMode;
  label: string;
  summary: string;
  tradeoff: string;
  defaultToolPermission: (tool: AutopilotToolDefinition) => ToolPermissionLevel;
  approvalRulesEnabled: boolean;
  limits: Partial<AgentExecutionLimitRecord>;
}

export const PROTECTION_PRESETS: Record<ProtectionMode, ProtectionPresetDefinition> = {
  safe: {
    mode: "safe",
    label: "Safe",
    summary: "Approvals for all external actions, read-only tools by default, low budget.",
    tradeoff: "Slowest automation, lowest risk — best when you're still validating the agent.",
    defaultToolPermission: (tool) => {
      if (tool.isHighRisk) return "ask_approval";
      return "read_only";
    },
    approvalRulesEnabled: true,
    limits: {
      maxCostPerRunUsd: 0.5,
      dailySpendingCapUsd: 5,
      maxToolCallsPerRun: 15,
      maxExecutionTimeSeconds: 120,
      maxRetries: 1,
      maxMessagesPerRun: 5,
    },
  },
  balanced: {
    mode: "balanced",
    label: "Balanced",
    summary: "Approval only for high-impact actions, limited write permissions.",
    tradeoff: "Good default for most startups — automation with guardrails on sensitive actions.",
    defaultToolPermission: (tool) => {
      if (tool.isHighRisk) return "ask_approval";
      if (tool.id === "browser" || tool.id === "files") {
        return "read_only";
      }
      return "draft_only";
    },
    approvalRulesEnabled: true,
    limits: {
      maxCostPerRunUsd: 2,
      dailySpendingCapUsd: 25,
      maxToolCallsPerRun: 40,
      maxExecutionTimeSeconds: 300,
      maxRetries: 2,
      maxMessagesPerRun: 20,
    },
  },
  autonomous: {
    mode: "autonomous",
    label: "Autonomous",
    summary: "Fewer approvals but strict limits, full logging, and easy emergency shutdown.",
    tradeoff: "Faster execution — only use when you trust the agent and monitor activity closely.",
    defaultToolPermission: (tool) => {
      if (tool.id === "stripe" || tool.id === "database") return "ask_approval";
      if (tool.isHighRisk) return "ask_approval";
      return "draft_only";
    },
    approvalRulesEnabled: true,
    limits: {
      maxCostPerRunUsd: 10,
      dailySpendingCapUsd: 100,
      maxToolCallsPerRun: 100,
      maxExecutionTimeSeconds: 600,
      maxRetries: 3,
      maxMessagesPerRun: 100,
    },
  },
};

export const DEFAULT_DATA_PROTECTION: DataProtectionSettings = {
  promptInjectionDefense: true,
  secretDetection: true,
  piiDetection: true,
  blockPromptExtraction: true,
  restrictSensitiveKb: true,
};

export const DEFAULT_APPROVAL_RULE_KEYS = [
  "send_message",
  "publish_content",
  "delete_data",
  "process_payments",
  "change_production_code",
  "export_customer_data",
  "access_secrets",
] as const;

export function defaultApprovalRulesForAgent(
  agentId: string,
  organizationId: string,
  mode: ProtectionMode
): Omit<AgentApprovalRuleRecord, "id">[] {
  const preset = PROTECTION_PRESETS[mode];
  return DEFAULT_APPROVAL_RULE_KEYS.map((ruleKey) => ({
    agentId,
    organizationId,
    ruleKey,
    enabled: preset.approvalRulesEnabled,
    thresholdValue: defaultThresholdForRule(ruleKey),
    thresholdUnit: thresholdUnitForRule(ruleKey),
  }));
}

function defaultThresholdForRule(ruleKey: string): number | null {
  switch (ruleKey) {
    case "send_message":
      return 20;
    case "process_payments":
      return 500;
    case "delete_data":
      return 10;
    default:
      return null;
  }
}

function thresholdUnitForRule(ruleKey: string): string | null {
  switch (ruleKey) {
    case "send_message":
      return "recipients";
    case "process_payments":
      return "usd";
    case "delete_data":
      return "records";
    default:
      return null;
  }
}

export function protectionModeIncreasesRisk(
  from: ProtectionMode,
  to: ProtectionMode
): boolean {
  const order: ProtectionMode[] = ["safe", "balanced", "autonomous"];
  return order.indexOf(to) > order.indexOf(from);
}
