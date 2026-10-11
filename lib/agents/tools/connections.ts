import { isWebSearchConfigured } from "./handlers/web-search";
import type {
  ToolConnectionRecord,
  ToolConnectionRequirement,
  ToolConnectionStatus,
  ZeltaToolDefinition,
} from "./types";

function envConfigured(names: string[] | undefined): boolean {
  if (!names?.length) return true;
  return names.every((name) => Boolean(process.env[name]?.trim()));
}

function envAnyConfigured(names: string[] | undefined): boolean {
  if (!names?.length) return true;
  return names.some((name) => Boolean(process.env[name]?.trim()));
}

export function resolveConnectionStatus(
  requirement: ToolConnectionRequirement
): ToolConnectionStatus {
  if (requirement.provider === "none") return "connected";
  if (requirement.provider === "web_search") {
    return isWebSearchConfigured() ? "connected" : "disconnected";
  }
  if (requirement.envVarsAny?.length) {
    return envAnyConfigured(requirement.envVarsAny) ? "connected" : "disconnected";
  }
  if (envConfigured(requirement.envVars)) return "connected";
  return "disconnected";
}

export function getMissingRequirements(
  requirement: ToolConnectionRequirement
): string[] {
  if (requirement.provider === "web_search" && !isWebSearchConfigured()) {
    return ["TAVILY_API_KEY or BRAVE_SEARCH_API_KEY"];
  }
  if (requirement.envVarsAny?.length) {
    return envAnyConfigured(requirement.envVarsAny)
      ? []
      : [requirement.envVarsAny.join(" or ")];
  }
  if (!requirement.envVars?.length) return [];
  return requirement.envVars.filter((name) => !process.env[name]?.trim());
}

export function buildToolConnectionSummary(
  tool: ZeltaToolDefinition
): ToolConnectionRecord[] {
  return tool.permissions.map((requirement) => {
    const status = resolveConnectionStatus(requirement);
    return {
      provider: requirement.provider,
      status,
      label: requirement.label,
      description: requirement.description,
      missingRequirements: getMissingRequirements(requirement),
      settingsPath: requirement.settingsPath,
    };
  });
}

export function toolConnectionsReady(tool: ZeltaToolDefinition): boolean {
  return tool.permissions.every(
    (requirement) => resolveConnectionStatus(requirement) === "connected"
  );
}

export function connectionBlockedMessage(
  tool: ZeltaToolDefinition
): string | null {
  for (const requirement of tool.permissions) {
    if (resolveConnectionStatus(requirement) === "connected") continue;
    const missing = getMissingRequirements(requirement);
    if (missing.length > 0) {
      return `${requirement.label} is not configured. Set ${missing.join(", ")} or connect in Settings.`;
    }
    return `${requirement.label} is not connected. ${requirement.description}`;
  }
  return null;
}

/** Providers exposed in settings UI. */
export const PLATFORM_TOOL_PROVIDERS: ToolConnectionRequirement[] = [
  {
    provider: "resend",
    label: "Email (Resend)",
    description: "Send emails through your Resend account.",
    envVars: ["RESEND_API_KEY", "RESEND_FROM_EMAIL"],
    settingsPath: "/settings?tab=integrations&provider=email",
  },
  {
    provider: "web_search",
    label: "Web search",
    description: "Search the web using Tavily or Brave Search.",
    envVarsAny: ["TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY"],
    settingsPath: "/settings?tab=integrations&provider=web_search",
  },
  {
    provider: "x_api",
    label: "X (Twitter)",
    description: "Read posts and draft replies on X (requires X API credentials).",
    envVars: ["X_API_BEARER_TOKEN"],
    settingsPath: "/settings?tab=integrations&provider=x",
  },
];
