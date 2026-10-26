import type { SupabaseClient } from "@supabase/supabase-js";
import { mapAgentRowOrThrow, mapUnknownAgentRow } from "./runtime-mappers";
import type {
  AgentPolicyRecord,
  BuilderAgentRecord,
  CreateBuilderAgentInput,
  UpdateBuilderAgentRuntimeInput,
} from "./types";

interface AgentPolicyRow {
  id: string;
  agent_id: string;
  threshold: number | null;
  auto_allow: boolean;
  created_at: string;
}

function mapPolicyRow(row: AgentPolicyRow): AgentPolicyRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    threshold: row.threshold,
    autoAllow: row.auto_allow,
    createdAt: row.created_at,
  };
}

function normalizeSlugBase(value: string): string {
  const trimmed = value.trim().replace(/-+$/g, "").slice(0, 48);
  return trimmed.length > 0 ? trimmed : "custom-agent";
}

const LEGACY_AGENT_COLUMNS = new Set([
  "name",
  "description",
  "source",
  "tools",
  "trigger_type",
  "suggested_threshold",
  "status",
]);

function isMissingColumnError(message: string | undefined): boolean {
  if (!message) return false;
  return (
    message.includes("schema cache") ||
    message.includes("Could not find") ||
    message.includes("column")
  );
}

function isInvalidEnumError(message: string | undefined): boolean {
  if (!message) return false;
  return message.includes("invalid input value for enum") || message.includes("enum");
}

function coreAgentPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const core: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (LEGACY_AGENT_COLUMNS.has(key)) {
      core[key] = value;
    }
  }
  return core;
}

function normalizeAgentStatusForLegacy(status: string): string {
  if (status === "published" || status === "testing") return "active";
  if (status === "paused") return "paused";
  return status;
}

export async function resolveUniqueAgentSlug(
  supabase: SupabaseClient,
  organizationId: string,
  baseSlug: string
): Promise<string> {
  const base = normalizeSlugBase(baseSlug);

  const { data, error } = await supabase
    .from("agents")
    .select("slug")
    .eq("organization_id", organizationId)
    .or(`slug.eq.${base},slug.like.${base}-%`);

  if (error) {
    throw new Error(error.message ?? "Failed to resolve agent slug.");
  }

  const taken = new Set((data ?? []).map((row) => String(row.slug)));
  if (!taken.has(base)) return base;

  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const candidate = `${base}-${suffix}`.slice(0, 64);
    if (!taken.has(candidate)) return candidate;
  }

  const randomSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${base}-${randomSuffix}`.slice(0, 64);
}

export async function insertBuilderAgent(
  supabase: SupabaseClient,
  params: {
    userId: string;
    organizationId: string;
    name: string;
    slug: string;
    description: string;
    source: string;
    tools: string[];
    triggerType: string;
    suggestedThreshold?: number | null;
    goal?: string | null;
    instructions?: string | null;
    model?: string | null;
    capabilities?: CreateBuilderAgentInput["capabilities"];
    schedule?: CreateBuilderAgentInput["schedule"];
    timezone?: string;
    memoryEnabled?: boolean;
    safetySettings?: CreateBuilderAgentInput["safetySettings"];
  }
): Promise<BuilderAgentRecord> {
  const coreInsert = {
    user_id: params.userId,
    organization_id: params.organizationId,
    name: params.name,
    slug: params.slug,
    description: params.description,
    source: params.source,
    tools: params.tools,
    trigger_type: params.triggerType,
    suggested_threshold: params.suggestedThreshold ?? null,
  };

  const extendedInsert = {
    goal: params.goal ?? params.description,
    instructions: params.instructions ?? null,
    model: params.model ?? null,
    capabilities: params.capabilities ?? [],
    schedule: params.schedule ?? { triggerType: params.triggerType },
    timezone: params.timezone ?? "UTC",
    memory_enabled: params.memoryEnabled ?? false,
    safety_settings: params.safetySettings ?? {},
  };

  let { data, error } = await supabase
    .from("agents")
    .insert({ ...coreInsert, ...extendedInsert })
    .select("*")
    .single();

  if (error && isMissingColumnError(error.message)) {
    ({ data, error } = await supabase
      .from("agents")
      .insert(coreInsert)
      .select("*")
      .single());
  }

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to insert agent.");
  }

  return mapAgentRowOrThrow(data, "Failed to insert agent.");
}

export async function updateBuilderAgent(
  supabase: SupabaseClient,
  params: {
    agentId: string;
    userId: string;
    patch: UpdateBuilderAgentRuntimeInput;
  }
): Promise<BuilderAgentRecord> {
  const patch: Record<string, unknown> = {};

  if (params.patch.name !== undefined) patch.name = params.patch.name;
  if (params.patch.description !== undefined) patch.description = params.patch.description;
  if (params.patch.goal !== undefined) patch.goal = params.patch.goal;
  if (params.patch.instructions !== undefined) patch.instructions = params.patch.instructions;
  if (params.patch.model !== undefined) patch.model = params.patch.model;
  if (params.patch.tools !== undefined) patch.tools = params.patch.tools;
  if (params.patch.capabilities !== undefined) patch.capabilities = params.patch.capabilities;
  if (params.patch.triggerType !== undefined) patch.trigger_type = params.patch.triggerType;
  if (params.patch.schedule !== undefined) patch.schedule = params.patch.schedule;
  if (params.patch.timezone !== undefined) patch.timezone = params.patch.timezone;
  if (params.patch.memoryEnabled !== undefined) patch.memory_enabled = params.patch.memoryEnabled;
  if (params.patch.safetySettings !== undefined) {
    patch.safety_settings = params.patch.safetySettings;
  }
  if (params.patch.status !== undefined) patch.status = params.patch.status;
  if (params.patch.publishedAt !== undefined) patch.published_at = params.patch.publishedAt;
  if (params.patch.suggestedThreshold !== undefined) {
    patch.suggested_threshold = params.patch.suggestedThreshold;
  }

  let { data, error } = await supabase
    .from("agents")
    .update(patch)
    .eq("id", params.agentId)
    .eq("user_id", params.userId)
    .select("*")
    .single();

  if (error && isMissingColumnError(error.message)) {
    ({ data, error } = await supabase
      .from("agents")
      .update(coreAgentPatch(patch))
      .eq("id", params.agentId)
      .eq("user_id", params.userId)
      .select("*")
      .single());
  }

  if (error && isInvalidEnumError(error.message) && typeof patch.status === "string") {
    ({ data, error } = await supabase
      .from("agents")
      .update({
        ...coreAgentPatch(patch),
        status: normalizeAgentStatusForLegacy(patch.status),
      })
      .eq("id", params.agentId)
      .eq("user_id", params.userId)
      .select("*")
      .single());
  }

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to update agent.");
  }

  return mapAgentRowOrThrow(data, "Failed to update agent.");
}

export async function insertAgentPolicy(
  supabase: SupabaseClient,
  params: {
    agentId: string;
    threshold?: number | null;
    autoAllow?: boolean;
  }
): Promise<AgentPolicyRecord> {
  const { data, error } = await supabase
    .from("agent_policies")
    .insert({
      agent_id: params.agentId,
      threshold: params.threshold ?? null,
      auto_allow: params.autoAllow ?? true,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to insert agent policy.");
  }

  return mapPolicyRow(data as AgentPolicyRow);
}

export async function getBuilderAgentRecordById(
  supabase: SupabaseClient,
  agentId: string
): Promise<BuilderAgentRecord | null> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("id", agentId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message ?? "Failed to load agent.");
  }

  if (!data) return null;
  return mapUnknownAgentRow(data);
}

export async function listBuilderAgentsForOrganization(
  supabase: SupabaseClient,
  organizationId: string
): Promise<BuilderAgentRecord[]> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(error.message ?? "Failed to list agents.");
  }

  return (data ?? [])
    .map((row) => mapUnknownAgentRow(row))
    .filter((agent): agent is BuilderAgentRecord => agent !== null);
}

export async function getBuilderAgentById(
  supabase: SupabaseClient,
  params: { agentId: string; userId: string }
): Promise<BuilderAgentRecord | null> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("id", params.agentId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message ?? "Failed to load agent.");
  }

  if (!data) return null;
  return mapUnknownAgentRow(data);
}

export async function getBuilderAgentBySlug(
  supabase: SupabaseClient,
  organizationId: string,
  slug: string
): Promise<BuilderAgentRecord | null> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    throw new Error(error.message ?? "Failed to load agent.");
  }

  if (!data) return null;
  return mapUnknownAgentRow(data);
}

export async function getAgentPolicyByAgentId(
  supabase: SupabaseClient,
  agentId: string
): Promise<AgentPolicyRecord | null> {
  const { data, error } = await supabase
    .from("agent_policies")
    .select("*")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message ?? "Failed to load agent policy.");
  }

  if (!data) return null;
  return mapPolicyRow(data as AgentPolicyRow);
}
