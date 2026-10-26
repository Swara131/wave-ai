import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";
import type { LoadedAgent } from "@/lib/agents/runtime/types";

export function loadedAgentFromRecord(agent: BuilderAgentRecord): LoadedAgent {
  return {
    record: agent,
    gatewayAgentId: agent.slug,
    systemPrompt: "",
    enabledTools: agent.tools ?? [],
  };
}

export function isLightingConciergeAgent(agent: Pick<BuilderAgentRecord, "source" | "safetySettings" | "name">): boolean {
  const source = agent.source ?? "";
  const slug = agent.safetySettings?.template?.slug ?? agent.safetySettings?.template?.id ?? "";
  return (
    source.includes("lighting-concierge") ||
    slug === "lighting-concierge" ||
    /lighting concierge/i.test(agent.name)
  );
}
