/**
 * Maps human-readable mission capabilities to concrete Wave tool names.
 * Used when agents define allowedCapabilities instead of (or in addition to) allowedTools.
 */
export const MISSION_CAPABILITY_TOOL_MAP: Record<string, string[]> = {
  web_search: ["web_search"],
  read_public_information: [
    "web_search",
    "read_document",
    "x_search",
    "http_request",
    "fetch_url",
  ],
  web_page: ["fetch_url"],
  read_documents: ["read_document"],
  query_data: ["query_supabase"],
  send_email: ["send_email"],
  http_integration: ["http_request"],
  social_search: ["x_search"],
};

export function resolveToolsFromCapabilities(capabilities: string[]): string[] {
  const tools = new Set<string>();

  for (const capability of capabilities) {
    const normalized = capability.trim().toLowerCase().replace(/\s+/g, "_");
    const mapped = MISSION_CAPABILITY_TOOL_MAP[normalized];
    if (mapped) {
      for (const tool of mapped) {
        tools.add(tool);
      }
    }
  }

  return [...tools];
}
