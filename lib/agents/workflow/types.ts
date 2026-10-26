/** Reusable workflow graph types. Stored in agents.safety_settings.workflowState. */

import type { ToolPermissionLevel } from "@/lib/safety/autopilot/types";

export type WorkflowNodeCategory =
  | "trigger"
  | "ai"
  | "tool"
  | "logic"
  | "data"
  | "output"
  | "safety";

export type WorkflowNodeType =
  | "trigger_manual"
  | "trigger_schedule"
  | "trigger_webhook"
  | "trigger_email"
  | "trigger_crm"
  | "trigger_form"
  | "ai_reasoning"
  | "ai_generation"
  | "ai_classification"
  | "ai_extract"
  | "ai_summarize"
  | "ai_score"
  | "tool"
  | "placeholder_tool"
  | "condition"
  | "branch"
  | "loop"
  | "filter"
  | "delay"
  | "router"
  | "data_read"
  | "data_transform"
  | "data_store"
  | "output_response"
  | "output_notification"
  | "output_email"
  | "safety_gate"
  | "safety_validation"
  | "safety_approval"
  | "safety_error";

export type WorkflowNodeStatus =
  | "idle"
  | "valid"
  | "warning"
  | "error"
  | "needs_connection";

export type WorkflowRunStepStatus =
  | "waiting"
  | "running"
  | "succeeded"
  | "needs_approval"
  | "blocked"
  | "failed";

export interface WorkflowNodeConfig {
  toolName?: string;
  capabilityId?: string;
  goal?: string;
  instructions?: string;
  permissionLevel?: ToolPermissionLevel;
  placeholderIntegration?: string;
  maxIterations?: number;
  maxRetries?: number;
  retryPolicy?: string;
  errorBehavior?: string;
  schedule?: {
    when?: "manual" | "daily" | "weekly" | "at_time" | "on_event";
    time?: string;
    days?: string[];
    timezone?: string;
  };
  triggerType?: "email" | "webhook" | "schedule";
  email?: {
    to?: string;
    subject?: string;
    sendMode?: "after_workflow" | "immediate";
  };
  condition?: {
    expression?: string;
  };
  branch?: {
    label?: string;
  };
  [key: string]: unknown;
}

export interface WorkflowGraphNode {
  id: string;
  type: WorkflowNodeType;
  category: WorkflowNodeCategory;
  name: string;
  description: string;
  config: WorkflowNodeConfig;
  status: WorkflowNodeStatus;
  /** Linear order used by sync and fallback layout. */
  position: number;
  /** Canvas coordinates (React Flow). */
  x?: number;
  y?: number;
}

export interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
}

export interface AgentWorkflowGraph {
  version: number;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

export interface WorkflowVersionSnapshot {
  id: string;
  createdAt: string;
  graph: AgentWorkflowGraph;
  note?: string;
}

export interface WorkflowRunRecord {
  id: string;
  startedAt: string;
  status: WorkflowRunStepStatus | "idle";
  durationMs?: number;
  summary: string;
}

export interface AgentWorkflowState {
  published: AgentWorkflowGraph;
  draft: AgentWorkflowGraph | null;
  lastVerifiedAt: string | null;
  verificationStatus: "valid" | "invalid" | "pending" | "unverified";
  versions?: WorkflowVersionSnapshot[];
  safetyReviewedAt?: string | null;
  runs?: WorkflowRunRecord[];
}

export type WorkflowValidationSeverity = "error" | "warning";

export interface WorkflowValidationIssue {
  id: string;
  severity: WorkflowValidationSeverity;
  message: string;
  nodeId?: string;
  actionLabel?: string;
  actionHref?: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  issues: WorkflowValidationIssue[];
  safetyScore?: number;
  highRisk?: boolean;
}

export interface WorkflowSafetyDiff {
  newTools: string[];
  newCapabilities: string[];
  requiresSafetyReview: boolean;
  message: string | null;
}

export interface WorkflowAgentConfigPatch {
  displayName?: string;
  goal: string;
  instructions: string;
  scheduleSummary: string;
  schedule: import("../runtime-types").AgentScheduleConfig;
  timezone: string;
  capabilityIds: import("../builder-capabilities").BuilderCapabilityId[];
  tools: string[];
  triggerType: "email" | "webhook" | "schedule";
  suggestedThreshold: number;
  deliveryMode?: import("../delivery/types").AgentDeliveryMode;
  destinationEmail?: string | null;
}

export const HIGH_IMPACT_WORKFLOW_TOOLS = [
  "issue_refund",
  "send_email",
  "send_whatsapp_message",
  "update_crm_record",
  "delete_crm_record",
  "create_service_quote",
  "request_electrician_visit",
  "request_travel_booking",
  "request_wedding_deposit",
  "request_group_reservation",
] as const;
