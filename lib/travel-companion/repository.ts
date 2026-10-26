import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentSafetySettings } from "@/lib/agents/runtime-types";
import type { TravelTrip } from "./types";

function isMissingTable(message: string | undefined): boolean {
  return Boolean(message && /travel_trips|42P01|does not exist/i.test(message));
}

export class MissingTravelTableError extends Error {
  constructor() {
    super("Travel trips are stored on this agent until the travel_trips table is applied.");
    this.name = "MissingTravelTableError";
  }
}

export function isMissingTravelTable(error: unknown): boolean {
  return error instanceof MissingTravelTableError;
}

export function travelTripsFromSafety(value: unknown): TravelTrip[] {
  if (!value || typeof value !== "object") return [];
  const trips = (value as { travelCompanion?: { trips?: unknown } }).travelCompanion?.trips;
  if (!Array.isArray(trips)) return [];
  return trips.filter((item): item is TravelTrip => Boolean(item && typeof item === "object" && "id" in item));
}

export function mergeTravelTripIntoSafety(safety: AgentSafetySettings, trip: TravelTrip): AgentSafetySettings {
  const trips = [trip, ...travelTripsFromSafety(safety).filter((item) => item.id !== trip.id)].slice(0, 20);
  return {
    ...safety,
    travelCompanion: {
      ...safety.travelCompanion,
      bookingThresholdInr: safety.travelCompanion?.bookingThresholdInr ?? safety.thresholdInr,
      trips: trips as unknown as Record<string, unknown>[],
    },
  };
}

function mapTrip(row: Record<string, unknown>): TravelTrip {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    userId: String(row.user_id),
    agentId: String(row.agent_id),
    idempotencyKey: String(row.idempotency_key ?? ""),
    intake: row.intake as TravelTrip["intake"],
    itinerary: row.itinerary as TravelTrip["itinerary"],
    qloo: row.qloo as TravelTrip["qloo"],
    safety: row.safety as TravelTrip["safety"],
    bookings: (row.bookings as TravelTrip["bookings"]) ?? [],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function findTravelTripByIdempotency(
  supabase: SupabaseClient,
  params: { userId: string; agentId: string; idempotencyKey: string }
): Promise<TravelTrip | null> {
  const { data, error } = await supabase
    .from("travel_trips")
    .select("*")
    .eq("user_id", params.userId)
    .eq("agent_id", params.agentId)
    .eq("idempotency_key", params.idempotencyKey)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error.message)) return null;
    throw new Error(error.message);
  }
  return data ? mapTrip(data as Record<string, unknown>) : null;
}

export async function getTravelTripForUser(
  supabase: SupabaseClient,
  params: { tripId: string; userId: string; agentId: string }
): Promise<TravelTrip | null> {
  const { data, error } = await supabase
    .from("travel_trips")
    .select("*")
    .eq("id", params.tripId)
    .eq("user_id", params.userId)
    .eq("agent_id", params.agentId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error.message)) return null;
    throw new Error(error.message);
  }
  return data ? mapTrip(data as Record<string, unknown>) : null;
}

export async function getLatestTravelTrip(
  supabase: SupabaseClient,
  params: { userId: string; agentId: string }
): Promise<TravelTrip | null> {
  const { data, error } = await supabase
    .from("travel_trips")
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
  return data ? mapTrip(data as Record<string, unknown>) : null;
}

export async function insertTravelTrip(supabase: SupabaseClient, trip: TravelTrip): Promise<TravelTrip> {
  const { data, error } = await supabase
    .from("travel_trips")
    .insert({
      id: trip.id,
      organization_id: trip.organizationId,
      user_id: trip.userId,
      agent_id: trip.agentId,
      idempotency_key: trip.idempotencyKey,
      intake: trip.intake,
      itinerary: trip.itinerary,
      qloo: trip.qloo,
      safety: trip.safety,
      bookings: trip.bookings,
    })
    .select("*")
    .single();
  if (error || !data) {
    if (isMissingTable(error?.message)) throw new MissingTravelTableError();
    throw new Error(error?.message ?? "Failed to save travel trip.");
  }
  return mapTrip(data as Record<string, unknown>);
}

export async function updateTravelTrip(
  supabase: SupabaseClient,
  params: { tripId: string; userId: string; patch: Partial<Pick<TravelTrip, "itinerary" | "safety" | "bookings" | "qloo">> }
): Promise<TravelTrip> {
  const { data, error } = await supabase
    .from("travel_trips")
    .update({
      ...(params.patch.itinerary ? { itinerary: params.patch.itinerary } : {}),
      ...(params.patch.safety ? { safety: params.patch.safety } : {}),
      ...(params.patch.bookings ? { bookings: params.patch.bookings } : {}),
      ...(params.patch.qloo ? { qloo: params.patch.qloo } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.tripId)
    .eq("user_id", params.userId)
    .select("*")
    .single();
  if (error || !data) {
    if (isMissingTable(error?.message)) throw new MissingTravelTableError();
    throw new Error(error?.message ?? "Failed to update travel trip.");
  }
  return mapTrip(data as Record<string, unknown>);
}
