import type { AllowedAgentTool, AllowedTriggerType } from "@/lib/xai/parse-agent-build";

/** Product marketplace categories (user-facing). */
export type MarketplaceCategory =
  | "sales-marketing"
  | "customer-support"
  | "operations-productivity"
  | "finance-commerce"
  | "developer-ai-safety"
  | "home-services"
  | "travel-lifestyle"
  | "events-planning";

/** Includes legacy catalog categories so old template rows still type-check. */
export type TemplateCategory =
  | MarketplaceCategory
  | "e-commerce"
  | "support"
  | "service"
  | "marketing"
  | "operations"
  | "finance";

export type TemplateFilterId = "all" | MarketplaceCategory;

export type TemplateRiskLevel = "low" | "medium" | "high";

export type TemplateTrigger =
  | AllowedTriggerType
  | "manual"
  | "inbox";

export interface TemplateToolPermission {
  tool: string;
  permission: "read_only" | "draft_only" | "ask_approval" | "allow";
}

export interface TemplateApprovalRule {
  id: string;
  label: string;
  required: boolean;
}

export interface TemplateExecutionLimits {
  maxToolCallsPerRun: number;
  maxRunDurationMs: number;
  dailySpendingCapUsd: number;
  maxMessagesPerRun: number;
}

export interface TemplateDataProtection {
  promptInjectionDefense: boolean;
  piiRedaction: boolean;
  secretDetection: boolean;
  auditLogs: boolean;
  emergencyPause: boolean;
}

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  summary: string;
  icon: string;
  category: TemplateCategory;
  defaultDescription: string;
  tools: AllowedAgentTool[];
  triggerType: AllowedTriggerType;
  supportsThreshold: boolean;
  defaultThreshold: number | null;
  createdAt?: string;
  /** Marketplace fields (optional on legacy 8 templates). */
  slug?: string;
  shortDescription?: string;
  longDescription?: string;
  tags?: string[];
  riskLevel?: TemplateRiskLevel;
  estimatedSetupMinutes?: number;
  suggestedIntegrations?: string[];
  defaultInstructions?: string;
  exampleTasks?: string[];
  defaultTrigger?: TemplateTrigger;
  defaultSafetyPreset?: "safe" | "balanced" | "autonomous";
  defaultToolPermissions?: TemplateToolPermission[];
  defaultApprovalRules?: TemplateApprovalRule[];
  defaultExecutionLimits?: TemplateExecutionLimits;
  defaultDataProtection?: TemplateDataProtection;
  isFeatured?: boolean;
  isPublished?: boolean;
  sortOrder?: number;
  requiresApproval?: boolean;
}

export interface TemplateCustomizations {
  threshold?: number;
  needsApproval: boolean;
  customInstructions?: string;
}

export interface CreateFromTemplateResult {
  agentId: string;
  apiKey: string;
  keyPrefix: string;
  name: string;
  description: string;
  tools: string[];
  triggerType: string;
  suggestedThreshold: number;
  templateId: string;
  templateName: string;
  riskLevel?: TemplateRiskLevel;
  spec: {
    name: string;
    description: string;
    tools: { toolName: string }[];
    triggerType: string;
  };
}

export interface TemplateListQuery {
  category?: TemplateFilterId | string | null;
  search?: string | null;
  riskLevel?: TemplateRiskLevel | "all" | null;
  requiresApproval?: boolean | null;
  tool?: string | null;
}
