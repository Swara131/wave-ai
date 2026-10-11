import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";
import type { ToolPermissionLevel } from "./types";

export interface AutopilotToolDefinition {
  id: string;
  label: string;
  category: string;
  isHighRisk: boolean;
  defaultPermission: ToolPermissionLevel;
  /** Builder capability / runtime tool IDs that map to this integration. */
  capabilityIds: string[];
  runtimeTools: string[];
}

/** Known integrations surfaced in Safety Autopilot. */
export const AUTOPILOT_TOOL_CATALOG: AutopilotToolDefinition[] = [
  {
    id: "gmail",
    label: "Gmail",
    category: "Messaging",
    isHighRisk: true,
    defaultPermission: "ask_approval",
    capabilityIds: ["email"],
    runtimeTools: ["send_email"],
  },
  {
    id: "slack",
    label: "Slack",
    category: "Messaging",
    isHighRisk: true,
    defaultPermission: "ask_approval",
    capabilityIds: [],
    runtimeTools: ["send_slack_message"],
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    category: "Messaging",
    isHighRisk: true,
    defaultPermission: "ask_approval",
    capabilityIds: ["whatsapp"],
    runtimeTools: ["send_whatsapp_message"],
  },
  {
    id: "stripe",
    label: "Stripe",
    category: "Payments",
    isHighRisk: true,
    defaultPermission: "ask_approval",
    capabilityIds: ["refunds"],
    runtimeTools: ["issue_refund", "process_payment"],
  },
  {
    id: "browser",
    label: "Browser",
    category: "Web",
    isHighRisk: false,
    defaultPermission: "read_only",
    capabilityIds: ["web_search", "http"],
    runtimeTools: ["web_search", "http_request", "browse_web"],
  },
  {
    id: "database",
    label: "Database",
    category: "Data",
    isHighRisk: true,
    defaultPermission: "read_only",
    capabilityIds: ["database"],
    runtimeTools: ["query_supabase", "query_database"],
  },
  {
    id: "github",
    label: "GitHub",
    category: "Code",
    isHighRisk: true,
    defaultPermission: "ask_approval",
    capabilityIds: [],
    runtimeTools: ["github_push", "github_create_pr"],
  },
  {
    id: "crm",
    label: "CRM",
    category: "Data",
    isHighRisk: true,
    defaultPermission: "ask_approval",
    capabilityIds: ["crm"],
    runtimeTools: ["update_crm_record"],
  },
  {
    id: "files",
    label: "Files & documents",
    category: "Data",
    isHighRisk: false,
    defaultPermission: "read_only",
    capabilityIds: ["files"],
    runtimeTools: ["read_document"],
  },
  {
    id: "calendar",
    label: "Calendar",
    category: "Productivity",
    isHighRisk: false,
    defaultPermission: "draft_only",
    capabilityIds: ["calendar"],
    runtimeTools: ["create_calendar_event"],
  },
];

const CATALOG_BY_ID = new Map(AUTOPILOT_TOOL_CATALOG.map((tool) => [tool.id, tool]));

export function getAutopilotTool(id: string): AutopilotToolDefinition | undefined {
  return CATALOG_BY_ID.get(id);
}

/** Resolve which catalog tools apply to this agent based on enabled capabilities/tools. */
export function resolveAgentAutopilotTools(agent: Pick<BuilderAgentRecord, "tools" | "capabilities">): AutopilotToolDefinition[] {
  const normalizedTools = new Set(agent.tools.map((t) => t.trim().toLowerCase()));
  const capabilityIds = new Set(
    (agent.capabilities ?? []).map((c) => (typeof c === "string" ? c : c.id).trim().toLowerCase())
  );

  const matched = AUTOPILOT_TOOL_CATALOG.filter((tool) => {
    if (tool.capabilityIds.some((id) => capabilityIds.has(id))) return true;
    if (tool.runtimeTools.some((rt) => normalizedTools.has(rt))) return true;
    return false;
  });

  if (matched.length > 0) return matched;

  return AUTOPILOT_TOOL_CATALOG.filter((tool) =>
    ["browser", "database", "gmail"].includes(tool.id)
  );
}

export function isHighRiskPermission(
  tool: AutopilotToolDefinition,
  level: ToolPermissionLevel
): boolean {
  if (level === "disabled" || level === "read_only" || level === "draft_only") {
    return false;
  }
  if (tool.isHighRisk && level === "automatic") return true;
  if (tool.id === "stripe") return true;
  if (tool.id === "database" && level === "automatic") return true;
  if (tool.id === "gmail" && level === "automatic") return true;
  return false;
}
