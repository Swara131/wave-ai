-- Wedding & Celebration Planner events: preferences, vendors, deposits, safety records.

CREATE TABLE IF NOT EXISTS public.wedding_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  intake JSONB NOT NULL DEFAULT '{}'::jsonb,
  plan JSONB,
  vendors JSONB NOT NULL DEFAULT '[]'::jsonb,
  tasks JSONB NOT NULL DEFAULT '[]'::jsonb,
  invitation JSONB,
  deposits JSONB NOT NULL DEFAULT '[]'::jsonb,
  budget JSONB NOT NULL DEFAULT '{}'::jsonb,
  conflicts JSONB NOT NULL DEFAULT '[]'::jsonb,
  safety JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS wedding_events_user_agent_idempotency_idx
  ON public.wedding_events (user_id, agent_id, idempotency_key);

CREATE INDEX IF NOT EXISTS wedding_events_user_created_idx
  ON public.wedding_events (user_id, created_at DESC);

ALTER TABLE public.wedding_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wedding_events_select_own"
  ON public.wedding_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "wedding_events_insert_own"
  ON public.wedding_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "wedding_events_update_own"
  ON public.wedding_events FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
