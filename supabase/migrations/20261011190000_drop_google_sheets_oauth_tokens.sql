-- Google Sheets integration was removed. Drop leftover OAuth token storage.
DROP TABLE IF EXISTS public.google_sheets_oauth_tokens;

NOTIFY pgrst, 'reload schema';
