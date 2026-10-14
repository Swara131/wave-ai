/**
 * Live-check delivery API keys from .env.local. Never prints secret values.
 * Usage: npx tsx scripts/check-delivery-keys.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getResendConfigStatus } from "../lib/email/resend-config";
import { sendHtmlEmail } from "../lib/email/resend-client";
import {
  getEffectiveWhatsAppFrom,
  isTwilioWhatsAppConfigured,
  isUsingWhatsAppSandbox,
} from "../lib/whatsapp/env";
import { readTavilyApiKey } from "../lib/agents/tools/handlers/web-search";

function loadEnvFile(filename: string): void {
  const path = resolve(process.cwd(), filename);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (value) process.env[key] = value;
  }
}

function present(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function mask(value: string | undefined): string {
  if (!value) return "(missing)";
  if (value.length <= 8) return `${value.slice(0, 2)}…`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

async function checkResend(): Promise<string> {
  const status = getResendConfigStatus();
  if (!status.configured) {
    return `FAIL — ${status.error ?? "not configured"}`;
  }

  const key = process.env.RESEND_API_KEY!.trim();
  const response = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${key}` },
  });
  const payload = (await response.json()) as { message?: string; name?: string };

  const sendOnly =
    response.status === 401 &&
    /restricted to only send emails/i.test(payload.message ?? "");

  if (!response.ok && !sendOnly) {
    return `FAIL — Resend rejected the key (${response.status}: ${payload.message ?? payload.name ?? "unauthorized"})`;
  }

  if (status.sandboxRecipient) {
    try {
      const sent = await sendHtmlEmail({
        to: status.sandboxRecipient,
        subject: "Wave key check",
        html: "<p>Resend API key works. This is a Wave connectivity test.</p>",
      });
      return `OK — send-only key accepted; test email sent (${sent.messageId}) to sandbox inbox`;
    } catch (err) {
      return `PARTIAL — key exists but send failed: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  }

  const extra = status.sandboxMode
    ? "sandbox sender; set RESEND_SANDBOX_RECIPIENT to prove delivery"
    : "production sender";
  return `OK — key accepted (${extra}${sendOnly ? "; send-only key" : ""})`;
}

async function checkTwilio(): Promise<string> {
  if (!isTwilioWhatsAppConfigured()) {
    const missing = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM"].filter(
      (name) => !present(name)
    );
    return `FAIL — missing ${missing.join(", ")}`;
  }

  const sid = process.env.TWILIO_ACCOUNT_SID!.trim();
  const token = process.env.TWILIO_AUTH_TOKEN!.trim();
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const payload = (await response.json()) as {
    status?: string;
    type?: string;
    message?: string;
    code?: number;
  };

  if (!response.ok) {
    return `FAIL — Twilio rejected the credentials (${response.status}: ${payload.message ?? "unauthorized"})`;
  }

  const from = getEffectiveWhatsAppFrom();
  const sandbox = isUsingWhatsAppSandbox();
  return `OK — account ${payload.status ?? "active"} (${payload.type ?? "unknown"}); WhatsApp from ${mask(from)} ${sandbox ? "sandbox" : "business sender"}`;
}

async function checkTavily(): Promise<string> {
  const key = readTavilyApiKey();
  if (!key) return "SKIP — TAVILY_API_KEY not set";

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: "ping", max_results: 1, search_depth: "basic" }),
  });
  if (!response.ok) {
    return `FAIL — Tavily rejected the key (${response.status})`;
  }
  return "OK — key accepted";
}

async function checkGroq(): Promise<string> {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) return "SKIP — GROQ_API_KEY not set";

  const response = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) {
    return `FAIL — Groq rejected the key (${response.status})`;
  }
  return "OK — key accepted";
}

async function main() {
  loadEnvFile(".env.local");

  const [resend, twilio, tavily, groq] = await Promise.all([
    checkResend(),
    checkTwilio(),
    checkTavily(),
    checkGroq(),
  ]);

  console.log("Resend email:", resend);
  console.log("Twilio WhatsApp:", twilio);
  console.log("Tavily search:", tavily);
  console.log("Groq LLM:", groq);
}

main().catch((err) => {
  console.error("Check failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
