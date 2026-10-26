import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentSafetySettings } from "@/lib/agents/runtime-types";
import type { GroupOuting } from "./types";

function isMissingTable(message: string | undefined): boolean {
  return Boolean(message && /group_outings|42P01|does not exist/i.test(message));
}

export class MissingGroupTableError extends Error {
  constructor() {
    super("Group outings are stored on this agent until the group_outings table is applied.");
    this.name = "MissingGroupTableError";
  }
}

export function isMissingGroupTable(error: unknown): boolean {
  if (error instanceof MissingGroupTableError) return true;
  return error instanceof Error && isMissingTable(error.message);
}

export function groupOutingsFromSafety(value: unknown): GroupOuting[] {
  if (!value || typeof value !== "object") return [];
  const outings = (value as { groupPlanner?: { outings?: unknown } }).groupPlanner?.outings;
  if (!Array.isArray(outings)) return [];
  return outings.filter((item): item is GroupOuting => Boolean(item && typeof item === "object" && "id" in item));
}

export function mergeGroupOutingIntoSafety(safety: AgentSafetySettings, outing: GroupOuting): AgentSafetySettings {
  const outings = [outing, ...groupOutingsFromSafety(safety).filter((item) => item.id !== outing.id)].slice(0, 20);
  return {
    ...safety,
    groupPlanner: {
      ...safety.groupPlanner,
      reservationThresholdInr: safety.groupPlanner?.reservationThresholdInr ?? safety.thresholdInr,
      outings: outings as unknown as Record<string, unknown>[],
    },
  };
}

function mapOuting(row: Record<string, unknown>): GroupOuting {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    userId: String(row.user_id),
    agentId: String(row.agent_id),
    idempotencyKey: String(row.idempotency_key ?? ""),
    intake: row.intake as GroupOuting["intake"],
    qloo: row.qloo as GroupOuting["qloo"],
    candidates: (row.candidates as GroupOuting["candidates"]) ?? [],
    recommendations: (row.recommendations as GroupOuting["recommendations"]) ?? [],
    feedback: (row.feedback as GroupOuting["feedback"]) ?? [],
    history: (row.history as GroupOuting["history"]) ?? [],
    itinerary: (row.itinerary as GroupOuting["itinerary"]) ?? null,
    reservation: (row.reservation as GroupOuting["reservation"]) ?? null,
    tooFewReason: (row.too_few_reason as string | null) ?? null,
    safety: row.safety as GroupOuting["safety"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function findGroupOutingByIdempotency(
  supabase: SupabaseClient,
  params: { userId: string; agentId: string; idempotencyKey: string }
): Promise<GroupOuting | null> {
  const { data, error } = await supabase
    .from("group_outings")
    .select("*")
    .eq("user_id", params.userId)
    .eq("agent_id", params.agentId)
    .eq("idempotency_key", params.idempotencyKey)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error.message)) return null;
    throw new Error(error.message);
  }
  return data ? mapOuting(data as Record<string, unknown>) : null;
}

export async function getGroupOutingForUser(
  supabase: SupabaseClient,
  params: { outingId: string; userId: string; agentId: string }
): Promise<GroupOuting | null> {
  const { data, error } = await supabase
    .from("group_outings")
    .select("*")
    .eq("id", params.outingId)
    .eq("user_id", params.userId)
    .eq("agent_id", params.agentId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error.message)) return null;
    throw new Error(error.message);
  }
  return data ? mapOuting(data as Record<string, unknown>) : null;
}

export async function getLatestGroupOuting(
  supabase: SupabaseClient,
  params: { userId: string; agentId: string }
): Promise<GroupOuting | null> {
  const { data, error } = await supabase
    .from("group_outings")
    .select("*")
    .eq("user_id", params.userId)
    .eq("agent_id", params.agentId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error.message)) return null;
    throw new Error(error.message);
  }
  return data ? mapOuting(data as Record<string, unknown>) : null;
}

export async function insertGroupOuting(supabase: SupabaseClient, outing: GroupOuting): Promise<GroupOuting> {
  const { data, error } = await supabase
    .from("group_outings")
    .insert({
      id: outing.id,
      user_id: outing.userId,
      organization_id: outing.organizationId,
      agent_id: outing.agentId,
      idempotency_key: outing.idempotencyKey,
      intake: outing.intake,
      qloo: outing.qloo,
      candidates: outing.candidates,
      recommendations: outing.recommendations,
      feedback: outing.feedback,
      history: outing.history,
      itinerary: outing.itinerary,
      reservation: outing.reservation,
      too_few_reason: outing.tooFewReason ?? null,
      safety: outing.safety,
    })
    .select("*")
    .single();
  if (error) {
    if (isMissingTable(error.message)) throw new MissingGroupTableError();
    throw new Error(error.message);
  }
  return mapOuting(data as Record<string, unknown>);
}

export async function updateGroupOuting(
  supabase: SupabaseClient,
  params: { outingId: string; userId: string; patch: Partial<GroupOuting> }
): Promise<GroupOuting> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (params.patch.intake) row.intake = params.patch.intake;
  if (params.patch.qloo) row.qloo = params.patch.qloo;
  if (params.patch.candidates) row.candidates = params.patch.candidates;
  if (params.patch.recommendations) row.recommendations = params.patch.recommendations;
  if (params.patch.feedback) row.feedback = params.patch.feedback;
  if (params.patch.history) row.history = params.patch.history;
  if (params.patch.itinerary !== undefined) row.itinerary = params.patch.itinerary;
  if (params.patch.reservation !== undefined) row.reservation = params.patch.reservation;
  if (params.patch.tooFewReason !== undefined) row.too_few_reason = params.patch.tooFewReason;
  if (params.patch.safety) row.safety = params.patch.safety;

  const { data, error } = await supabase
    .from("group_outings")
    .update(row)
    .eq("id", params.outingId)
    .eq("user_id", params.userId)
    .select("*")
    .single();
  if (error) {
    if (isMissingTable(error.message)) throw new MissingGroupTableError();
    throw new Error(error.message);
  }
  return mapOuting(data as Record<string, unknown>);
}
