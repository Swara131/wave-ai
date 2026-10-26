import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentSafetySettings } from "@/lib/agents/runtime-types";
import type { LightingJob, LightingRates } from "./types";

function isMissingTable(message: string | undefined): boolean {
  return Boolean(message && /lighting_jobs|42P01|does not exist/i.test(message));
}

export class MissingLightingTableError extends Error {
  constructor() {
    super("Lighting jobs are stored on this agent until the lighting_jobs table is applied.");
    this.name = "MissingLightingTableError";
  }
}

export function isMissingLightingTable(error: unknown): boolean {
  return error instanceof MissingLightingTableError;
}

export function lightingJobsFromSafety(value: unknown): LightingJob[] {
  if (!value || typeof value !== "object") return [];
  const jobs = (value as { lightingConcierge?: { jobs?: unknown } }).lightingConcierge?.jobs;
  if (!Array.isArray(jobs)) return [];
  return jobs.filter((item): item is LightingJob => Boolean(item && typeof item === "object" && "id" in item));
}

export function mergeLightingJobIntoSafety(
  safety: AgentSafetySettings,
  job: LightingJob
): AgentSafetySettings {
  const jobs = [job, ...lightingJobsFromSafety(safety).filter((item) => item.id !== job.id)].slice(0, 20);
  return {
    ...safety,
    lightingConcierge: {
      ...safety.lightingConcierge,
      jobs: jobs as unknown as Record<string, unknown>[],
    },
  };
}

function mapJob(row: Record<string, unknown>): LightingJob {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    userId: String(row.user_id),
    agentId: String(row.agent_id),
    idempotencyKey: String(row.idempotency_key ?? ""),
    intake: row.intake as LightingJob["intake"],
    plan: row.plan as LightingJob["plan"],
    quote: row.quote as LightingJob["quote"],
    qloo: row.qloo as LightingJob["qloo"],
    safety: row.safety as LightingJob["safety"],
    address: row.address as LightingJob["address"],
    appointment: row.appointment as LightingJob["appointment"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function findLightingJobByIdempotency(
  supabase: SupabaseClient,
  params: { userId: string; agentId: string; idempotencyKey: string }
): Promise<LightingJob | null> {
  const { data, error } = await supabase
    .from("lighting_jobs")
    .select("*")
    .eq("user_id", params.userId)
    .eq("agent_id", params.agentId)
    .eq("idempotency_key", params.idempotencyKey)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error.message)) return null;
    throw new Error(error.message);
  }
  return data ? mapJob(data as Record<string, unknown>) : null;
}

export async function getLightingJobForUser(
  supabase: SupabaseClient,
  params: { jobId: string; userId: string; agentId: string }
): Promise<LightingJob | null> {
  const { data, error } = await supabase
    .from("lighting_jobs")
    .select("*")
    .eq("id", params.jobId)
    .eq("user_id", params.userId)
    .eq("agent_id", params.agentId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error.message)) return null;
    throw new Error(error.message);
  }
  return data ? mapJob(data as Record<string, unknown>) : null;
}

export async function getLatestLightingJob(
  supabase: SupabaseClient,
  params: { userId: string; agentId: string }
): Promise<LightingJob | null> {
  const { data, error } = await supabase
    .from("lighting_jobs")
    .select("*")
    .eq("user_id", params.userId)
    .eq("agent_id", params.agentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error.message)) return null;
    throw new Error(error.message);
  }
  return data ? mapJob(data as Record<string, unknown>) : null;
}

export async function insertLightingJob(
  supabase: SupabaseClient,
  job: Omit<LightingJob, "createdAt" | "updatedAt">
): Promise<LightingJob> {
  const { data, error } = await supabase
    .from("lighting_jobs")
    .insert({
      id: job.id,
      organization_id: job.organizationId,
      user_id: job.userId,
      agent_id: job.agentId,
      idempotency_key: job.idempotencyKey,
      intake: job.intake,
      plan: job.plan,
      quote: job.quote,
      qloo: job.qloo,
      safety: job.safety,
      address: job.address,
      appointment: job.appointment,
    })
    .select("*")
    .single();
  if (error || !data) {
    if (isMissingTable(error?.message)) throw new MissingLightingTableError();
    throw new Error(error?.message ?? "Failed to save lighting job.");
  }
  return mapJob(data as Record<string, unknown>);
}

export async function updateLightingJob(
  supabase: SupabaseClient,
  params: {
    jobId: string;
    userId: string;
    patch: Partial<Pick<LightingJob, "quote" | "plan" | "safety" | "address" | "appointment" | "qloo">>;
  }
): Promise<LightingJob> {
  const { data, error } = await supabase
    .from("lighting_jobs")
    .update({
      ...(params.patch.quote ? { quote: params.patch.quote } : {}),
      ...(params.patch.plan ? { plan: params.patch.plan } : {}),
      ...(params.patch.safety ? { safety: params.patch.safety } : {}),
      ...(params.patch.address ? { address: params.patch.address } : {}),
      ...(params.patch.appointment ? { appointment: params.patch.appointment } : {}),
      ...(params.patch.qloo ? { qloo: params.patch.qloo } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.jobId)
    .eq("user_id", params.userId)
    .select("*")
    .single();
  if (error || !data) {
    if (isMissingTable(error?.message)) throw new MissingLightingTableError();
    throw new Error(error?.message ?? "Failed to update lighting job.");
  }
  return mapJob(data as Record<string, unknown>);
}

export function ratesFromSafety(value: unknown): LightingRates | null {
  if (!value || typeof value !== "object") return null;
  const rates = (value as { lightingConcierge?: { rates?: LightingRates } }).lightingConcierge?.rates;
  if (!rates) return null;
  if (typeof rates.labourPerHourInr !== "number") return null;
  return rates;
}
