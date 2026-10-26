-- Travel Companion trips: preferences, itineraries, booking requests, safety records.

CREATE TABLE IF NOT EXISTS public.travel_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  intake JSONB NOT NULL DEFAULT '{}'::jsonb,
  itinerary JSONB NOT NULL DEFAULT '{}'::jsonb,
  qloo JSONB NOT NULL DEFAULT '{}'::jsonb,
  safety JSONB NOT NULL DEFAULT '{}'::jsonb,
  bookings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS travel_trips_user_agent_idempotency_idx
  ON public.travel_trips (user_id, agent_id, idempotency_key);

CREATE INDEX IF NOT EXISTS travel_trips_user_created_idx
  ON public.travel_trips (user_id, created_at DESC);

ALTER TABLE public.travel_trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "travel_trips_select_own"
  ON public.travel_trips FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "travel_trips_insert_own"
  ON public.travel_trips FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "travel_trips_update_own"
  ON public.travel_trips FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
