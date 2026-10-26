-- Lighting Concierge jobs: plans, quotes, address verification, appointment requests.

CREATE TABLE IF NOT EXISTS public.lighting_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  intake JSONB NOT NULL DEFAULT '{}'::jsonb,
  plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  quote JSONB NOT NULL DEFAULT '{}'::jsonb,
  qloo JSONB NOT NULL DEFAULT '{}'::jsonb,
  safety JSONB NOT NULL DEFAULT '{}'::jsonb,
  address JSONB NOT NULL DEFAULT '{}'::jsonb,
  appointment JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lighting_jobs_user_agent_idempotency_idx
  ON public.lighting_jobs (user_id, agent_id, idempotency_key);

CREATE INDEX IF NOT EXISTS lighting_jobs_user_created_idx
  ON public.lighting_jobs (user_id, created_at DESC);

ALTER TABLE public.lighting_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lighting_jobs_select_own"
  ON public.lighting_jobs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "lighting_jobs_insert_own"
  ON public.lighting_jobs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "lighting_jobs_update_own"
  ON public.lighting_jobs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
