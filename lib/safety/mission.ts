import { normalizeEnabledTools } from "@/lib/agents/tools/registry";
import { getToolDefinition, listToolDefinitions } from "@/lib/agents/tools/catalog";
import type { LoadedAgent } from "@/lib/agents/runtime/types";
import type {
  AgentMission,
  AgentSafetySettings,
  AgentSafetySettingsExtended,
  MissionResourceRestrictions,
  MissionRestriction,
} from "@/lib/agents/runtime-types";
import { resolveToolsFromCapabilities } from "./mission-capabilities";

/** True when stored safety_settings.mission contains an explicit lock configuration. */
export function missionConfigEnablesLock(
  mission: AgentSafetySettingsExtended["mission"] | undefined
): boolean {
  if (!mission || typeof mission !== "object") {
    return false;
  }

  return Boolean(
    mission.goal?.trim() ||
      (mission.allowedTools && mission.allowedTools.length > 0) ||
      (mission.allowedActions && mission.allowedActions.length > 0) ||
      (mission.allowedCapabilities && mission.allowedCapabilities.length > 0) ||
      (mission.restrictions && mission.restrictions.length > 0) ||
      mission.resourceRestrictions
  );
}

/** True when the agent has an explicit mission lock configuration in safety_settings. */
export function hasExplicitMissionLock(agent: LoadedAgent): boolean {
  return missionConfigEnablesLock(agent.record.safetySettings?.mission);
}

const READ_ONLY_TOOLS = new Set([
  "web_search",
  "read_document",
  "query_supabase",
  "google_sheets",
  "x_search",
  "fetch_url",
]);

const FINANCIAL_TOOLS = new Set(["issue_refund", "create_service_quote", "request_travel_booking", "request_wedding_deposit", "request_group_reservation"]);

const KNOWN_RESTRICTIONS: MissionRestriction[] = [
  "no_destructive_operations",
  "no_financial_actions",
  "read_only_tools_only",
  "no_file_deletion",
  "no_payments",
  "no_database_modifications",
  "no_unrelated_communications",
];

function parseMissionRestrictions(value: unknown): MissionRestriction[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is MissionRestriction =>
      typeof item === "string" && KNOWN_RESTRICTIONS.includes(item as MissionRestriction)
  );
}

function parseResourceRestrictions(value: unknown): MissionResourceRestrictions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw = value as MissionResourceRestrictions;
  return {
    allowedResourceTypes: Array.isArray(raw.allowedResourceTypes)
      ? raw.allowedResourceTypes.filter((item) => typeof item === "string")
      : undefined,
    blockedResourceTypes: Array.isArray(raw.blockedResourceTypes)
      ? raw.blockedResourceTypes.filter((item) => typeof item === "string")
      : undefined,
    allowedEnvironments: Array.isArray(raw.allowedEnvironments)
      ? raw.allowedEnvironments.filter((item) => typeof item === "string")
      : undefined,
    blockedEnvironments: Array.isArray(raw.blockedEnvironments)
      ? raw.blockedEnvironments.filter((item) => typeof item === "string")
      : undefined,
    maxEmailRecipients:
      typeof raw.maxEmailRecipients === "number" && raw.maxEmailRecipients >= 0
        ? raw.maxEmailRecipients
        : undefined,
  };
}

function deriveAllowedActions(
  allowedTools: string[],
  explicit: string[] | null | undefined
): string[] | null {
  if (explicit && explicit.length > 0) {
    return [...new Set(explicit.map((action) => action.trim()).filter(Boolean))];
  }

  const actionTypes = allowedTools
    .map((toolName) => getToolDefinition(toolName)?.actionType)
    .filter((actionType): actionType is string => Boolean(actionType));

  return actionTypes.length > 0 ? [...new Set(actionTypes)] : null;
}

function resolveAllowedTools(params: {
  missionConfig: AgentSafetySettingsExtended["mission"];
  agent: LoadedAgent;
}): string[] {
  const capabilityTools = params.missionConfig?.allowedCapabilities?.length
    ? resolveToolsFromCapabilities(params.missionConfig.allowedCapabilities)
    : [];

  const explicitTools = params.missionConfig?.allowedTools?.length
    ? normalizeEnabledTools(params.missionConfig.allowedTools)
    : [];

  const fallbackTools = normalizeEnabledTools(
    params.agent.enabledTools.length > 0
      ? params.agent.enabledTools
      : params.agent.record.tools
  );

  if (explicitTools.length > 0 && capabilityTools.length > 0) {
    const capabilitySet = new Set(capabilityTools);
    return explicitTools.filter((tool) => capabilitySet.has(tool));
  }

  if (explicitTools.length > 0) {
    return explicitTools;
  }

  if (capabilityTools.length > 0) {
    const enabled = new Set(fallbackTools);
    return capabilityTools.filter((tool) => enabled.has(tool));
  }

  return fallbackTools;
}

/**
 * Resolves mission config from safety_settings.mission with safe defaults from
 * existing agent fields (goal, tools). Backward compatible for agents with no mission block.
 */
export function resolveAgentMission(agent: LoadedAgent): AgentMission {
  const safety = (agent.record.safetySettings ?? {}) as AgentSafetySettings &
    AgentSafetySettingsExtended;
  const missionConfig = safety.mission;
  const lockEnabled = hasExplicitMissionLock(agent);

  const allowedTools = resolveAllowedTools({ missionConfig, agent });

  const goal =
    missionConfig?.goal?.trim() ||
    agent.record.goal?.trim() ||
    agent.record.description?.trim() ||
    null;

  const allowedActions = deriveAllowedActions(
    allowedTools,
    missionConfig?.allowedActions ?? null
  );

  const restrictions = parseMissionRestrictions(missionConfig?.restrictions);
  const resourceRestrictions = parseResourceRestrictions(
    missionConfig?.resourceRestrictions
  );

  const allowedCapabilities = Array.isArray(missionConfig?.allowedCapabilities)
    ? missionConfig!.allowedCapabilities!.filter((item) => typeof item === "string")
    : [];

  return {
    goal,
    allowedTools,
    allowedActions,
    allowedCapabilities,
    restrictions,
    resourceRestrictions,
    lockEnabled,
  };
}

export function isReadOnlyTool(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}

export function isFinancialTool(toolName: string): boolean {
  return FINANCIAL_TOOLS.has(toolName);
}

export function listKnownToolNames(): string[] {
  return listToolDefinitions().map((tool) => tool.name);
}
