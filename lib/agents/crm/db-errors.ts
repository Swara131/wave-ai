export const CRM_UPDATES_TABLE = "agent_crm_updates";

export const CRM_TABLE_MISSING_MESSAGE =
  "Table public.agent_crm_updates is missing from the connected Supabase project. Apply supabase/migrations/20260926160000_agent_crm_updates.sql by running npm run migrate:crm-updates (needs SUPABASE_DB_URL) or paste that file in the Supabase SQL Editor. Do not disable Row Level Security.";

export function isMissingCrmTableError(message: string): boolean {
  return /schema cache|could not find the table|does not exist|PGRST205|agent_crm_updates/i.test(
    message
  ) && /schema cache|could not find|does not exist|PGRST205/i.test(message);
}

export function sanitizeDatabaseError(message: string): string {
  return message
    .replace(/postgresql:\/\/[^@\s]+@/gi, "postgresql://***@")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]")
    .replace(/\bsb_secret_[A-Za-z0-9]+/g, "[redacted-secret]")
    .replace(/\bsb_publishable_[A-Za-z0-9]+/g, "[redacted-publishable]")
    .replace(/(?:service_role|anon|apikey|authorization)[=:\s]+[^\s,;]+/gi, "[redacted-credential]");
}

export function logDatabaseQueryDiagnostic(params: {
  table: string;
  code?: string | null;
  message: string;
}): void {
  console.warn("[database] query did not succeed", {
    table: params.table,
    code: params.code ?? null,
    reason: sanitizeDatabaseError(params.message),
  });
}
