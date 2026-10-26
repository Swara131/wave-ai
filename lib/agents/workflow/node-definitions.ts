import type { BuilderCapabilityId } from "@/lib/agents/builder-capabilities";
import { BUILDER_CAPABILITY_OPTIONS } from "@/lib/agents/builder-capabilities";
import { resolveToolName } from "@/lib/agents/tools/catalog";
import type { WorkflowGraphNode, WorkflowNodeCategory, WorkflowNodeType } from "./types";

export interface WorkflowNodeDefinition {
  type: WorkflowNodeType;
  category: WorkflowNodeCategory;
  label: string;
  description: string;
  icon: string;
  toolName?: string;
  capabilityId?: BuilderCapabilityId;
}

const TOOL_ORDER: string[] = [
  "fetch_url",
  "web_search",
  "read_document",
  "google_sheets",
  "query_supabase",
  "http_request",
  "x_search",
  "update_crm_record",
  "delete_crm_record",
  "issue_refund",
  "send_email",
  "send_whatsapp_message",
  "create_calendar_event",
];

export const WORKFLOW_NODE_CATALOG: WorkflowNodeDefinition[] = [
  {
    type: "trigger_manual",
    category: "trigger",
    label: "Manual trigger",
    description: "Run when you start the agent",
    icon: "👆",
  },
  {
    type: "trigger_schedule",
    category: "trigger",
    label: "Schedule",
    description: "Run on a recurring schedule",
    icon: "⏰",
  },
  {
    type: "trigger_webhook",
    category: "trigger",
    label: "Webhook / event",
    description: "Start when Wave receives a signal",
    icon: "📡",
  },
  {
    type: "ai_reasoning",
    category: "ai",
    label: "AI reasoning",
    description: "Plan and decide next steps",
    icon: "🧠",
  },
  {
    type: "ai_generation",
    category: "ai",
    label: "AI generation",
    description: "Generate or summarize content",
    icon: "✨",
  },
  {
    type: "ai_classification",
    category: "ai",
    label: "Classification",
    description: "Classify or score inputs",
    icon: "🏷️",
  },
  {
    type: "condition",
    category: "logic",
    label: "Condition",
    description: "Branch based on a rule",
    icon: "◆",
  },
  {
    type: "loop",
    category: "logic",
    label: "Loop",
    description: "Repeat with a max iteration limit",
    icon: "🔁",
  },
  {
    type: "branch",
    category: "logic",
    label: "Branch",
    description: "Split into parallel paths",
    icon: "⑂",
  },
  {
    type: "data_read",
    category: "data",
    label: "Read data",
    description: "Load data from a source",
    icon: "📥",
  },
  {
    type: "data_transform",
    category: "data",
    label: "Transform",
    description: "Format or reshape data",
    icon: "🔄",
  },
  {
    type: "output_response",
    category: "output",
    label: "Response",
    description: "Return a response to the user",
    icon: "💬",
  },
  {
    type: "output_notification",
    category: "output",
    label: "Notification",
    description: "Send an in-app notification",
    icon: "🔔",
  },
  {
    type: "output_email",
    category: "output",
    label: "Send email",
    description: "Deliver results by email",
    icon: "✉️",
  },
  {
    type: "safety_gate",
    category: "safety",
    label: "Safety gate",
    description: "Wave policy and risk checks",
    icon: "🛡️",
  },
  {
    type: "trigger_email",
    category: "trigger",
    label: "New email",
    description: "Start when a new email arrives",
    icon: "✉️",
  },
  {
    type: "trigger_crm",
    category: "trigger",
    label: "New CRM lead",
    description: "Start when a CRM lead is created",
    icon: "👥",
  },
  {
    type: "trigger_form",
    category: "trigger",
    label: "Form submission",
    description: "Start from a new form response",
    icon: "📝",
  },
  {
    type: "ai_extract",
    category: "ai",
    label: "Extract data",
    description: "Pull structured fields from text",
    icon: "🧩",
  },
  {
    type: "ai_summarize",
    category: "ai",
    label: "Summarize",
    description: "Condense long content",
    icon: "🧾",
  },
  {
    type: "ai_score",
    category: "ai",
    label: "Score / evaluate",
    description: "Score or qualify an input",
    icon: "⭐",
  },
  {
    type: "filter",
    category: "logic",
    label: "Filter",
    description: "Keep or drop items by a rule",
    icon: "⛳",
  },
  {
    type: "delay",
    category: "logic",
    label: "Delay",
    description: "Wait before the next step",
    icon: "⏳",
  },
  {
    type: "router",
    category: "logic",
    label: "Router",
    description: "Send to one of several paths",
    icon: "↕",
  },
  {
    type: "safety_validation",
    category: "safety",
    label: "Input validation",
    description: "Reject incomplete or unsafe input",
    icon: "✅",
  },
  {
    type: "safety_approval",
    category: "safety",
    label: "Approval gate",
    description: "Pause for a human decision",
    icon: "✋",
  },
  {
    type: "safety_error",
    category: "safety",
    label: "Error handler",
    description: "Catch failures and escalate",
    icon: "🧯",
  },
  {
    type: "placeholder_tool",
    category: "tool",
    label: "Gmail (sample)",
    description: "Sample connector — not executable until wired",
    icon: "📧",
  },
];

for (const option of BUILDER_CAPABILITY_OPTIONS) {
  for (const toolName of option.tools) {
    WORKFLOW_NODE_CATALOG.push({
      type: "tool",
      category: "tool",
      label: option.label,
      description: option.description,
      icon: toolIcon(toolName),
      toolName,
      capabilityId: option.id,
    });
  }
}

function toolIcon(toolName: string): string {
  switch (toolName) {
    case "web_search":
      return "🔍";
    case "send_email":
      return "✉️";
    case "http_request":
    case "fetch_url":
      return "🌐";
    case "google_sheets":
      return "📊";
    case "x_search":
      return "𝕏";
    case "issue_refund":
      return "💳";
    case "send_whatsapp_message":
      return "💬";
    case "query_supabase":
      return "🗄️";
    case "read_document":
      return "📄";
    case "update_crm_record":
    case "delete_crm_record":
      return "👥";
    case "create_calendar_event":
      return "📅";
    default:
      return "🔧";
  }
}

export function getNodeDefinition(
  type: WorkflowNodeType,
  toolName?: string
): WorkflowNodeDefinition | undefined {
  if (type === "tool" && toolName) {
    const resolved = resolveToolName(toolName);
    return WORKFLOW_NODE_CATALOG.find(
      (item) => item.type === "tool" && item.toolName === resolved
    );
  }
  return WORKFLOW_NODE_CATALOG.find((item) => item.type === type);
}

export function orderToolsLogically(tools: string[]): string[] {
  const normalized = [...new Set(tools.map((tool) => resolveToolName(tool)))];
  return normalized.sort((a, b) => {
    const ai = TOOL_ORDER.indexOf(a);
    const bi = TOOL_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

export function categoryLabel(category: WorkflowNodeCategory): string {
  switch (category) {
    case "trigger":
      return "Triggers";
    case "ai":
      return "AI";
    case "tool":
      return "Tools";
    case "logic":
      return "Logic";
    case "data":
      return "Data";
    case "output":
      return "Output";
    case "safety":
      return "Safety";
    default:
      return category;
  }
}

export function createCatalogNode(
  type: WorkflowNodeType,
  nextPosition: number,
  toolName?: string
): WorkflowGraphNode | null {
  const definition = getNodeDefinition(type, toolName);
  if (!definition) return null;
  const placeholder =
    definition.type === "placeholder_tool"
      ? definition.label.replace(/ \(sample\)$/i, "")
      : undefined;
  return {
    id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: definition.type,
    category: definition.category,
    name: definition.label,
    description: definition.description,
    config: {
      ...(toolName ? { toolName, capabilityId: definition.capabilityId } : {}),
      ...(placeholder ? { placeholderIntegration: placeholder.toLowerCase() } : {}),
      ...(definition.type === "loop" ? { maxIterations: 10, maxRetries: 2 } : {}),
    },
    status: "idle",
    position: nextPosition,
    x: 320,
    y: 80 + nextPosition * 24,
  };
}
