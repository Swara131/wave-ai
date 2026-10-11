import type { RiskSeverity } from "@/lib/risk-types";
import type { MatchedPolicyReason } from "@/lib/gateway/policy/types";

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function describeToolAction(toolName: string, payload: Record<string, unknown>): string {
  switch (toolName) {
    case "send_email": {
      const to = readString(payload.to) ?? readString(payload.recipient) ?? "a recipient";
      const subject = readString(payload.subject);
      return subject
        ? `send an email to ${to} with subject "${subject}"`
        : `send an email to ${to}`;
    }
    case "issue_refund": {
      const amount = typeof payload.amount === "number" ? payload.amount : null;
      const major = amount != null && amount >= 100 ? amount / 100 : amount;
      return major != null
        ? `issue a refund of ₹${major.toLocaleString("en-IN")}`
        : "issue a refund";
    }
    case "web_search":
      return `search the web for "${readString(payload.query) ?? "information"}"`;
    case "http_request":
      return `make an HTTP ${readString(payload.method) ?? "GET"} request to ${readString(payload.url) ?? "an external service"}`;
    case "read_document":
      return "read one of your uploaded documents";
    case "query_supabase":
      return `look up rows in your ${readString(payload.table) ?? "workspace"} data`;
    case "google_sheets":
      return "use a retired Google Sheets tool";
    case "x_search":
      return `search X for "${readString(payload.query) ?? "posts"}"`;
    default:
      return `run ${toolName.replace(/_/g, " ")}`;
  }
}

export function buildProtectionSummary(params: {
  agentName: string;
  toolName: string;
  payload: Record<string, unknown>;
  decision: "ALLOW" | "REVIEW" | "BLOCK";
  reason: string;
  riskLevel: RiskSeverity;
}): { summary: string; why: string } {
  const action = describeToolAction(params.toolName, params.payload);
  const summary = `${params.agentName} wants to ${action}.`;

  let why: string;
  switch (params.decision) {
    case "ALLOW":
      why = params.reason || "Wave Protection checked this action and it looks safe to run.";
      break;
    case "REVIEW":
      why =
        params.reason ||
        "This action has a higher impact, so Wave paused the agent until you approve it.";
      break;
    case "BLOCK":
      why =
        params.reason ||
        "This action could cause serious harm, so Wave blocked it.";
      break;
  }

  return { summary, why };
}

export function riskLevelLabel(level: RiskSeverity): string {
  switch (level) {
    case "low":
      return "Low risk";
    case "medium":
      return "Medium risk";
    case "high":
      return "High risk";
    case "critical":
      return "Critical risk";
  }
}

export function primaryPolicyReason(policies: MatchedPolicyReason[]): string | null {
  return policies[0]?.reason ?? null;
}
