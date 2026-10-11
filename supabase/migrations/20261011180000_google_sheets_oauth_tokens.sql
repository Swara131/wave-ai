-- Per-user Google Sheets OAuth tokens. Tokens are stored encrypted at rest.
-- Service role and the owning user may read/write their own row.

CREATE TABLE IF NOT EXISTS public.google_sheets_oauth_tokens (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  refresh_token_cipher TEXT NOT NULL,
  access_token_cipher TEXT,
  access_expires_at TIMESTAMPTZ,
  google_email TEXT,
  scopes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.google_sheets_oauth_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "google_sheets_oauth_tokens_owner"
  ON public.google_sheets_oauth_tokens FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_sheets_oauth_tokens TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_sheets_oauth_tokens TO service_role;

NOTIFY pgrst, 'reload schema';
