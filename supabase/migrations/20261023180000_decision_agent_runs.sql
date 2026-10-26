-- Research runs for multiple-decision agents. Non-destructive.

CREATE TABLE IF NOT EXISTS public.decision_agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  decision_agent_id UUID REFERENCES public.decision_agents(id) ON DELETE SET NULL,
  idempotency_key TEXT,
  title TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  report JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS decision_agent_runs_user_idempotency_idx
  ON public.decision_agent_runs (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS decision_agent_runs_user_created_idx
  ON public.decision_agent_runs (user_id, created_at DESC);

ALTER TABLE public.decision_agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "decision_agent_runs_select_own"
  ON public.decision_agent_runs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "decision_agent_runs_insert_own"
  ON public.decision_agent_runs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "decision_agent_runs_update_own"
  ON public.decision_agent_runs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE ON public.decision_agent_runs TO authenticated;

NOTIFY pgrst, 'reload schema';
