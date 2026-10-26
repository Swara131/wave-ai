import type { AgentCapabilityEntry } from "./runtime-types";

/** User-facing integrations — no technical jargon. */
export const BUILDER_CAPABILITY_OPTIONS = [
  {
    id: "web_search",
    label: "Web search",
    description: "Search the web for up-to-date information",
    tools: ["web_search"],
  },
  {
    id: "http",
    label: "HTTP requests",
    description: "Call external APIs and webhooks",
    tools: ["http_request"],
  },
  {
    id: "web_page",
    label: "Read a link",
    description: "Open a YouTube, article, or other public URL and summarize what is actually there",
    tools: ["fetch_url"],
  },
  {
    id: "email",
    label: "Email",
    description: "Send email through your connected provider",
    tools: ["send_email"],
  },
  {
    id: "x",
    label: "X",
    description: "Search recent posts on X",
    tools: ["x_search"],
  },
  {
    id: "database",
    label: "Your data",
    description: "Look up information in your Wave workspace",
    tools: ["query_supabase"],
  },
  {
    id: "files",
    label: "Files & documents",
    description: "Read files you uploaded to Wave",
    tools: ["read_document"],
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    description: "Send WhatsApp messages",
    tools: ["send_whatsapp_message"],
  },
  {
    id: "calendar",
    label: "Calendar",
    description: "Schedule meetings and events",
    tools: ["create_calendar_event"],
  },
  {
    id: "crm",
    label: "CRM",
    description: "Update customer records",
    tools: ["update_crm_record"],
  },
  {
    id: "refunds",
    label: "Refunds",
    description: "Issue customer refunds",
    tools: ["issue_refund"],
  },
] as const;

export type BuilderCapabilityId = (typeof BUILDER_CAPABILITY_OPTIONS)[number]["id"];

export const BUILDER_CAPABILITY_ID_VALUES = BUILDER_CAPABILITY_OPTIONS.map(
  (option) => option.id
) as [BuilderCapabilityId, ...BuilderCapabilityId[]];

const CAPABILITY_BY_ID = new Map(
  BUILDER_CAPABILITY_OPTIONS.map((option) => [option.id, option])
);

export function capabilityToEntries(ids: BuilderCapabilityId[]): AgentCapabilityEntry[] {
  return ids
    .map((id) => CAPABILITY_BY_ID.get(id))
    .filter(Boolean)
    .map((option) => ({
      id: option!.id,
      label: option!.label,
      enabled: true,
      description: option!.description,
    }));
}

export function capabilityIdsToTools(ids: BuilderCapabilityId[]): string[] {
  const tools = new Set<string>();
  for (const id of ids) {
    const option = CAPABILITY_BY_ID.get(id);
    if (!option) continue;
    for (const tool of option.tools) {
      tools.add(tool);
    }
  }
  return [...tools];
}

export function inferCapabilityIdsFromTools(tools: string[]): BuilderCapabilityId[] {
  const normalized = new Set(tools.map((tool) => tool.trim().toLowerCase()));
  const ids: BuilderCapabilityId[] = [];

  for (const option of BUILDER_CAPABILITY_OPTIONS) {
    if (option.tools.some((tool) => normalized.has(tool))) {
      ids.push(option.id);
    }
  }

  if (normalized.has("query_database")) {
    ids.push("database");
  }
  if (normalized.has("send_email") && !ids.includes("email")) {
    ids.push("email");
  }

  return [...new Set(ids)];
}

export function inferCapabilityIdsFromText(text: string): BuilderCapabilityId[] {
  const normalized = text.toLowerCase();
  const ids = new Set<BuilderCapabilityId>();

  const urlJob =
    /\b(youtube|youtu\.be|tiktok|instagram|vimeo|web\s*page|webpage|blog post|article|video|podcast)\b/.test(
      normalized
    ) ||
    /\b(from (a |the )?(url|link)|paste (a |the )?link|platform link|video link|web link)\b/.test(
      normalized
    );

  if (urlJob) {
    ids.add("web_page");
  }

  if (
    !urlJob &&
    /\b(search the web|web search|google|look up online|find new|latest|headlines|morning summary|news every|ai news|research)\b/.test(
      normalized
    )
  ) {
    ids.add("web_search");
  }
  if (!urlJob && /\bnews\b/.test(normalized)) {
    ids.add("web_search");
  }
  if (/\b(http|api|webhook|rest)\b/.test(normalized) && !urlJob) {
    ids.add("http");
  }
  if (/\b(x|twitter|tweet|posts on x)\b/.test(normalized)) {
    ids.add("x");
  }
  if (/\b(email|e-mail|mail|inbox)\b/.test(normalized)) {
    ids.add("email");
  }
  if (/\b(document|file|upload|pdf|csv)\b/.test(normalized)) {
    ids.add("files");
  }
  if (/\b(whatsapp|text message|sms)\b/.test(normalized)) {
    ids.add("whatsapp");
  }
  if (/\b(calendar|meeting|schedule event|appointment)\b/.test(normalized)) {
    ids.add("calendar");
  }
  if (/\b(crm|customer record|update record)\b/.test(normalized)) {
    ids.add("crm");
  }
  if (/\b(database|lookup|search records|your data)\b/.test(normalized)) {
    ids.add("database");
  }
  if (/\b(refund|money back|₹|inr)\b/.test(normalized)) {
    ids.add("refunds");
  }

  if (ids.size === 0) {
    if (/\b(find|monitor|track|summarize|research|report|scan|read)\b/.test(normalized)) {
      ids.add("web_search");
    } else {
      ids.add("email");
    }
  }

  return [...ids];
}

export function formatCapabilityLabels(ids: BuilderCapabilityId[]): string {
  return ids
    .map((id) => CAPABILITY_BY_ID.get(id)?.label)
    .filter(Boolean)
    .join(", ");
}

function isBuilderCapabilityId(value: string): value is BuilderCapabilityId {
  return BUILDER_CAPABILITY_OPTIONS.some((option) => option.id === value);
}

/** Merge stored capabilities/tools with what the agent goal implies. */
export function resolveCapabilityIdsForAgent(params: {
  tools: string[];
  capabilities?: Array<{ id: string }>;
  goal?: string | null;
  description?: string;
  instructions?: string | null;
  originalDescription?: string | null;
}): BuilderCapabilityId[] {
  const fromStored = params.capabilities?.length
    ? params.capabilities
        .map((item) => item.id)
        .filter(isBuilderCapabilityId)
    : inferCapabilityIdsFromTools(params.tools);

  const fromGoal = inferCapabilityIdsFromText(
    [params.goal, params.description, params.instructions, params.originalDescription]
      .filter(Boolean)
      .join(" ")
  );

  return [...new Set([...fromStored, ...fromGoal, ...inferCapabilityIdsFromTools(params.tools)])];
}

export function resolveCapabilityLabelsForAgent(params: {
  tools: string[];
  capabilities?: Array<{ id: string; label?: string }>;
  goal?: string | null;
  description?: string;
  instructions?: string | null;
}): string[] {
  return resolveCapabilityIdsForAgent(params)
    .map((id) => CAPABILITY_BY_ID.get(id)?.label)
    .filter(Boolean) as string[];
}

export function resolveAgentToolsForAgent(params: {
  tools: string[];
  capabilities?: Array<{ id: string }>;
  goal?: string | null;
  description?: string;
  instructions?: string | null;
}): string[] {
  const fromCapabilities = capabilityIdsToTools(resolveCapabilityIdsForAgent(params));
  return [...new Set([...params.tools, ...fromCapabilities])];
}

export function agentRequiresWebSearch(params: {
  tools: string[];
  capabilities?: Array<{ id: string }>;
  goal?: string | null;
  description?: string;
  instructions?: string | null;
}): boolean {
  return resolveCapabilityIdsForAgent(params).includes("web_search");
}

export function extractSourcesFromSummary(summary: string | null | undefined): string[] {
  if (!summary) return [];
  const lines = summary.split("\n");
  const sources: string[] = [];
  let inSources = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^sources:?$/i.test(trimmed)) {
      inSources = true;
      continue;
    }
    if (inSources && trimmed.startsWith("- ")) {
      sources.push(trimmed.slice(2).trim());
    }
  }

  return sources;
}
