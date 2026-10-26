import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentSafetySettings } from "@/lib/agents/runtime-types";
import type { WeddingEvent } from "./types";

function isMissingTable(message: string | undefined): boolean {
  return Boolean(message && /wedding_events|42P01|does not exist/i.test(message));
}

export class MissingWeddingTableError extends Error {
  constructor() {
    super("Wedding events are stored on this agent until the wedding_events table is applied.");
    this.name = "MissingWeddingTableError";
  }
}

export function isMissingWeddingTable(error: unknown): boolean {
  return error instanceof MissingWeddingTableError;
}

export function weddingEventsFromSafety(value: unknown): WeddingEvent[] {
  if (!value || typeof value !== "object") return [];
  const events = (value as { weddingPlanner?: { events?: unknown } }).weddingPlanner?.events;
  if (!Array.isArray(events)) return [];
  return events.filter((item): item is WeddingEvent => Boolean(item && typeof item === "object" && "id" in item));
}

export function mergeWeddingEventIntoSafety(safety: AgentSafetySettings, event: WeddingEvent): AgentSafetySettings {
  const events = [event, ...weddingEventsFromSafety(safety).filter((item) => item.id !== event.id)].slice(0, 20);
  return {
    ...safety,
    weddingPlanner: {
      ...safety.weddingPlanner,
      depositThresholdInr: safety.weddingPlanner?.depositThresholdInr ?? safety.thresholdInr,
      events: events as unknown as Record<string, unknown>[],
    },
  };
}

function mapEvent(row: Record<string, unknown>): WeddingEvent {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    userId: String(row.user_id),
    agentId: String(row.agent_id),
    idempotencyKey: String(row.idempotency_key ?? ""),
    intake: row.intake as WeddingEvent["intake"],
    plan: (row.plan as WeddingEvent["plan"]) ?? null,
    vendors: (row.vendors as WeddingEvent["vendors"]) ?? [],
    tasks: (row.tasks as WeddingEvent["tasks"]) ?? [],
    invitation: (row.invitation as WeddingEvent["invitation"]) ?? null,
    deposits: (row.deposits as WeddingEvent["deposits"]) ?? [],
    budget: row.budget as WeddingEvent["budget"],
    conflicts: (row.conflicts as WeddingEvent["conflicts"]) ?? [],
    safety: row.safety as WeddingEvent["safety"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function findWeddingEventByIdempotency(
  supabase: SupabaseClient,
  params: { userId: string; agentId: string; idempotencyKey: string }
): Promise<WeddingEvent | null> {
  const { data, error } = await supabase
    .from("wedding_events")
    .select("*")
    .eq("user_id", params.userId)
    .eq("agent_id", params.agentId)
    .eq("idempotency_key", params.idempotencyKey)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error.message)) return null;
    throw new Error(error.message);
  }
  return data ? mapEvent(data as Record<string, unknown>) : null;
}

export async function getWeddingEventForUser(
  supabase: SupabaseClient,
  params: { eventId: string; userId: string; agentId: string }
): Promise<WeddingEvent | null> {
  const { data, error } = await supabase
    .from("wedding_events")
    .select("*")
    .eq("id", params.eventId)
    .eq("user_id", params.userId)
    .eq("agent_id", params.agentId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error.message)) return null;
    throw new Error(error.message);
  }
  return data ? mapEvent(data as Record<string, unknown>) : null;
}

export async function getLatestWeddingEvent(
  supabase: SupabaseClient,
  params: { userId: string; agentId: string }
): Promise<WeddingEvent | null> {
  const { data, error } = await supabase
    .from("wedding_events")
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
  return data ? mapEvent(data as Record<string, unknown>) : null;
}

export async function insertWeddingEvent(supabase: SupabaseClient, event: WeddingEvent): Promise<WeddingEvent> {
  const { data, error } = await supabase
    .from("wedding_events")
    .insert({
      id: event.id,
      organization_id: event.organizationId,
      user_id: event.userId,
      agent_id: event.agentId,
      idempotency_key: event.idempotencyKey,
      intake: event.intake,
      plan: event.plan,
      vendors: event.vendors,
      tasks: event.tasks,
      invitation: event.invitation,
      deposits: event.deposits,
      budget: event.budget,
      conflicts: event.conflicts,
      safety: event.safety,
    })
    .select("*")
    .single();
  if (error || !data) {
    if (isMissingTable(error?.message)) throw new MissingWeddingTableError();
    throw new Error(error?.message ?? "Failed to save wedding event.");
  }
  return mapEvent(data as Record<string, unknown>);
}

export async function updateWeddingEvent(
  supabase: SupabaseClient,
  params: {
    eventId: string;
    userId: string;
    patch: Partial<
      Pick<WeddingEvent, "intake" | "plan" | "vendors" | "tasks" | "invitation" | "deposits" | "budget" | "conflicts" | "safety">
    >;
  }
): Promise<WeddingEvent> {
  const { data, error } = await supabase
    .from("wedding_events")
    .update({
      ...(params.patch.intake ? { intake: params.patch.intake } : {}),
      ...(params.patch.plan !== undefined ? { plan: params.patch.plan } : {}),
      ...(params.patch.vendors ? { vendors: params.patch.vendors } : {}),
      ...(params.patch.tasks ? { tasks: params.patch.tasks } : {}),
      ...(params.patch.invitation !== undefined ? { invitation: params.patch.invitation } : {}),
      ...(params.patch.deposits ? { deposits: params.patch.deposits } : {}),
      ...(params.patch.budget ? { budget: params.patch.budget } : {}),
      ...(params.patch.conflicts ? { conflicts: params.patch.conflicts } : {}),
      ...(params.patch.safety ? { safety: params.patch.safety } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.eventId)
    .eq("user_id", params.userId)
    .select("*")
    .single();
  if (error || !data) {
    if (isMissingTable(error?.message)) throw new MissingWeddingTableError();
    throw new Error(error?.message ?? "Failed to update wedding event.");
  }
  return mapEvent(data as Record<string, unknown>);
}
