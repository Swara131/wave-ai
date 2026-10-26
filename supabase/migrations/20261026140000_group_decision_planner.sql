-- Group Decision Planner outings: participants, Qloo evidence, recommendations, feedback, reservations.

CREATE TABLE IF NOT EXISTS public.group_outings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  intake JSONB NOT NULL DEFAULT '{}'::jsonb,
  qloo JSONB NOT NULL DEFAULT '{}'::jsonb,
  candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  feedback JSONB NOT NULL DEFAULT '[]'::jsonb,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  itinerary JSONB,
  reservation JSONB,
  too_few_reason TEXT,
  safety JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS group_outings_user_agent_idempotency_idx
  ON public.group_outings (user_id, agent_id, idempotency_key);

CREATE INDEX IF NOT EXISTS group_outings_user_created_idx
  ON public.group_outings (user_id, created_at DESC);

ALTER TABLE public.group_outings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_outings_select_own"
  ON public.group_outings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "group_outings_insert_own"
  ON public.group_outings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "group_outings_update_own"
  ON public.group_outings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
