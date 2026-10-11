/** Internal Wave agent runtime data model (Phase 2). */

export type AgentRecordStatus =
  | "draft"
  | "active"
  | "archived"
  | "testing"
  | "published"
  | "paused";

export type AgentRunStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout";

export type AgentRunMode = "test" | "manual" | "scheduled" | "live";

export type AgentActionStatus =
  | "proposed"
  | "allowed"
  | "review_required"
  | "approved"
  | "rejected"
  | "blocked"
  | "executed"
  | "failed"
  | "skipped";

export type ToolExecutionStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export type AgentScheduleFrequency =
  | "manual"
  | "daily"
  | "weekly"
  | "monthly"
  | "custom";

export type AgentScheduleStatus =
  | "idle"
  | "scheduled"
  | "running"
  | "paused"
  | "waiting"
  | "error";

/** Human-facing capability entry stored in agents.capabilities. */
export interface AgentCapabilityEntry {
  id: string;
  label: string;
  enabled?: boolean;
  description?: string;
}

/** When the agent should work (agents.schedule). */
export interface AgentScheduleConfig {
  /** manual | daily | weekly | at_time | on_event */
  when?: "manual" | "daily" | "weekly" | "at_time" | "on_event";
  time?: string;
  days?: string[];
  startDate?: string;
  endDate?: string;
  /** Mirrors trigger_type for backward compatibility */
  triggerType?: "email" | "webhook" | "schedule";
}

import type { PolicyConditions } from "@/lib/gateway/policy/types";

export type MissionRestriction =
  | "no_destructive_operations"
  | "no_financial_actions"
  | "read_only_tools_only"
  | "no_file_deletion"
  | "no_payments"
  | "no_database_modifications"
  | "no_unrelated_communications";

export interface MissionResourceRestrictions {
  /** If set, only these resource types (e.g. api, file, database) are permitted. */
  allowedResourceTypes?: string[];
  blockedResourceTypes?: string[];
  allowedEnvironments?: string[];
  blockedEnvironments?: string[];
  maxEmailRecipients?: number;
}

/** Structured agent mission — stored in agents.safety_settings.mission or derived from agent fields. */
export interface AgentMission {
  goal: string | null;
  allowedTools: string[];
  allowedActions: string[] | null;
  /** Human-readable capability labels resolved to tools (see mission-capabilities.ts). */
  allowedCapabilities: string[];
  restrictions: MissionRestriction[];
  resourceRestrictions: MissionResourceRestrictions | null;
  /** True when safety_settings.mission was explicitly configured (mission lock active). */
  lockEnabled: boolean;
}

/** User-configurable safety policy (stored in agents.safety_settings.policies). */
export interface SafetyPolicy {
  id: string;
  name: string;
  description: string;
  priority?: number;
  tool?: string | string[];
  action?: string | string[];
  condition?: Partial<PolicyConditions>;
  decision: "ALLOW" | "REQUIRE_APPROVAL" | "BLOCK";
}

export interface AgentSafetySettingsExtended {
  mission?: {
    goal?: string | null;
    allowedTools?: string[];
    allowedActions?: string[] | null;
    allowedCapabilities?: string[];
    restrictions?: MissionRestriction[];
    resourceRestrictions?: MissionResourceRestrictions;
  };
  policies?: SafetyPolicy[];
}

/** Visual workflow draft/publish state stored in agents.safety_settings.workflowState. */
export interface AgentWorkflowPersistenceState {
  published: {
    version: number;
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  };
  draft: {
    version: number;
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  } | null;
  lastVerifiedAt: string | null;
  verificationStatus: "valid" | "invalid" | "pending" | "unverified";
}

import type { AgentPlatformLifecycle } from "./platform/lifecycle-types";
import type { ExternalAgentConnection } from "./external/types";
import type { SimulationRun } from "@/lib/templates/simulation/types";
import type { AgentDataSourceConfig } from "./data-source/types";

/** Per-agent protection settings (agents.safety_settings). */
export interface AgentSafetySettings extends AgentSafetySettingsExtended {
  workflowState?: AgentWorkflowPersistenceState | import("./workflow/types").AgentWorkflowState;
  platformLifecycle?: AgentPlatformLifecycle;
  externalConnection?: ExternalAgentConnection;
  template?: {
    id: string;
    name: string;
    slug?: string;
    riskLevel?: "low" | "medium" | "high";
    permissionsReviewedAt?: string | null;
  };
  requireApprovalFor?: string[];
  maxToolCallsPerRun?: number;
  maxRunDurationMs?: number;
  thresholdInr?: number;
  autoAllowBelowThreshold?: boolean;
  delivery?: {
    mode: "email" | "whatsapp" | "notification" | "both" | "none";
    destinationEmail?: string | null;
    /** E.164 WhatsApp recipient, e.g. +919876543210 */
    destinationPhone?: string | null;
  };
  /** User answers that change which requirements apply (output channel, customer source). */
  requirementChoices?: {
    output?: "notification" | "email" | "whatsapp" | "slack" | "other";
    customerSource?: "crm" | "csv" | "database" | "api" | "other";
    [key: string]: string | undefined;
  };
  /** Persisted prepare-your-agent answers, keyed by requirement id. */
  setupAnswers?: Record<string, string>;
  pendingRequirementKey?: string | null;
  requirementManifest?: {
    generatedAt: string;
    keys: string[];
  };
  lastChannelTests?: {
    email?: { ok: boolean; to?: string; messageId?: string; error?: string; at: string };
    whatsapp?: { ok: boolean; to?: string; messageId?: string; error?: string; at: string };
  };
  /** Last template simulation run, stored in safety_settings JSON. */
  simulationState?: {
    lastRun: SimulationRun | null;
  };
  dataSource?: AgentDataSourceConfig;
}

export interface AgentRunLimits {
  maxToolCalls?: number;
  maxDurationMs?: number;
  maxTokens?: number;
}

/** Extended builder agent with runtime configuration. */
export interface BuilderAgentRecord {
  id: string;
  userId: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string;
  goal: string | null;
  instructions: string | null;
  model: string | null;
  source: string;
  /** Enabled tool/capability IDs (legacy builder field). */
  tools: string[];
  capabilities: AgentCapabilityEntry[];
  triggerType: "email" | "webhook" | "schedule";
  schedule: AgentScheduleConfig;
  timezone: string;
  memoryEnabled: boolean;
  safetySettings: AgentSafetySettings;
  suggestedThreshold: number | null;
  status: AgentRecordStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentPolicyRecord {
  id: string;
  agentId: string;
  threshold: number | null;
  autoAllow: boolean;
  createdAt: string;
}

export interface AgentRunRecord {
  id: string;
  agentId: string;
  userId: string;
  organizationId: string;
  status: AgentRunStatus;
  mode: AgentRunMode;
  triggerSource: string | null;
  summary: string | null;
  errorMessage: string | null;
  limits: AgentRunLimits;
  metadata: Record<string, unknown>;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunStepRecord {
  id: string;
  agentRunId: string;
  organizationId: string;
  userId: string;
  sequence: number;
  stepKey: string;
  label: string;
  detail: string | null;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AgentActionRecord {
  id: string;
  agentRunId: string;
  agentId: string;
  userId: string;
  organizationId: string;
  actionProposalId: string | null;
  sequence: number;
  toolName: string;
  actionType: string;
  summary: string | null;
  status: AgentActionStatus;
  policyDecision: "allow" | "review" | "block" | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ToolExecutionRecord {
  id: string;
  agentRunId: string | null;
  agentActionId: string | null;
  actionProposalId: string | null;
  agentId: string;
  userId: string;
  organizationId: string;
  toolName: string;
  status: ToolExecutionStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentScheduleRecord {
  id: string;
  agentId: string;
  userId: string;
  organizationId: string;
  frequency: AgentScheduleFrequency;
  timezone: string;
  scheduleConfig: AgentScheduleConfig;
  cronExpression: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  enabled: boolean;
  status: AgentScheduleStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Reused tables (not duplicated):
 * - Approvals → action_proposals + approval_decisions (via AgentActionRecord.actionProposalId)
 * - Activity → audit_logs + audit_events (filter by builderAgentId / agentRunId on rows)
 */

export interface RuntimeDataModelRefs {
  approvalsTable: "action_proposals";
  approvalDecisionsTable: "approval_decisions";
  activityLogsTable: "audit_logs";
  runtimeEventsTable: "audit_events";
}

export const RUNTIME_DATA_MODEL_REFS: RuntimeDataModelRefs = {
  approvalsTable: "action_proposals",
  approvalDecisionsTable: "approval_decisions",
  activityLogsTable: "audit_logs",
  runtimeEventsTable: "audit_events",
};

export interface CreateBuilderAgentInput {
  name: string;
  description: string;
  source?: string;
  tools: string[];
  triggerType: "email" | "webhook" | "schedule";
  suggestedThreshold?: number;
  autoAllow?: boolean;
  goal?: string;
  instructions?: string;
  model?: string;
  capabilities?: AgentCapabilityEntry[];
  schedule?: AgentScheduleConfig;
  timezone?: string;
  memoryEnabled?: boolean;
  safetySettings?: AgentSafetySettings;
}

export interface UpdateBuilderAgentRuntimeInput {
  name?: string;
  description?: string;
  goal?: string;
  instructions?: string;
  model?: string;
  tools?: string[];
  capabilities?: AgentCapabilityEntry[];
  triggerType?: "email" | "webhook" | "schedule";
  schedule?: AgentScheduleConfig;
  timezone?: string;
  memoryEnabled?: boolean;
  safetySettings?: AgentSafetySettings;
  status?: AgentRecordStatus;
  publishedAt?: string | null;
  suggestedThreshold?: number | null;
}
