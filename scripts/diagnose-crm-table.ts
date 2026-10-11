/**
 * Safe diagnostic for public.agent_crm_updates. Prints no secrets.
 * Run: npx tsx scripts/diagnose-crm-table.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAdminClient } from "../lib/supabase/admin";
import { isMissingCrmTableError } from "../lib/agents/crm/repository";

function loadEnvLocal() {
  try {
    const content = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (process.env[key]) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    console.log("env_file=missing");
  }
}

function present(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function hostFromUrl(raw: string): string {
  try {
    return new URL(raw).host;
  } catch {
    return "invalid";
  }
}

function sanitizeDbError(message: string): string {
  return message
    .replace(/postgresql:\/\/[^@\s]+@/gi, "postgresql://***@")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]")
    .replace(/sb_secret_[A-Za-z0-9]+/g, "[redacted-secret]")
    .replace(/sb_publishable_[A-Za-z0-9]+/g, "[redacted-publishable]");
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  console.log("env.NEXT_PUBLIC_SUPABASE_URL", present("NEXT_PUBLIC_SUPABASE_URL"));
  console.log("env.supabaseHost", url ? hostFromUrl(url) : "unset");
  console.log("env.NEXT_PUBLIC_SUPABASE_ANON_KEY", present("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
  console.log("env.SUPABASE_SERVICE_ROLE_KEY", present("SUPABASE_SERVICE_ROLE_KEY"));
  console.log("env.SUPABASE_SECRET_KEY", present("SUPABASE_SECRET_KEY"));
  console.log("env.SUPABASE_DB_URL", present("SUPABASE_DB_URL"));

  const admin = createAdminClient();

  const agents = await admin.from("agents").select("id").limit(1);
  if (agents.error) {
    console.log("query.agents.status", "error");
    console.log("query.agents.code", agents.error.code ?? "none");
    console.log("query.agents.message", sanitizeDbError(agents.error.message));
  } else {
    console.log("query.agents.status", "ok");
    console.log("query.agents.rowCount", agents.data?.length ?? 0);
  }

  const crm = await admin.from("agent_crm_updates").select("id").limit(1);
  if (crm.error) {
    console.log("query.agent_crm_updates.status", "error");
    console.log("query.agent_crm_updates.code", crm.error.code ?? "none");
    console.log("query.agent_crm_updates.message", sanitizeDbError(crm.error.message));
    console.log("query.agent_crm_updates.missingTable", isMissingCrmTableError(crm.error.message));
  } else {
    console.log("query.agent_crm_updates.status", "ok");
    console.log("query.agent_crm_updates.rowCount", crm.data?.length ?? 0);
  }
}

void main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.log("fatal", message.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]"));
  process.exitCode = 1;
});
