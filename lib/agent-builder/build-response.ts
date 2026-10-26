import type { AgentSpec } from "./types";
import type { AgentBuildParseResult } from "@/lib/xai/parse-agent-build";
import { slugifyAgentId } from "./slug";
import { getGrokModel } from "@/lib/xai/env";

export interface AgentBuildView {
  success?: true;
  name?: string;
  description?: string;
  triggerType?: string;
  suggestedThreshold?: number;
  spec: AgentSpec;
  trigger: string;
  tools: string[];
  suggestedThresholdInr: number | null;
  sentence: string;
}

function parseInrAmount(text: string): number | null {
  const match = text.match(/₹\s*([\d,]+)/);
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

export function extractSuggestedThresholdInr(spec: AgentSpec): number | null {
  for (const rule of spec.protection) {
    const label = rule.label.toLowerCase();
    if (label.includes("up to") || label.includes("under")) {
      const amount = parseInrAmount(rule.label);
      if (amount != null) return amount;
    }
  }

  for (const rule of spec.protection) {
    if (rule.level === "allow") {
      const amount = parseInrAmount(rule.label);
      if (amount != null) return amount;
    }
  }

  const purposeAmount = parseInrAmount(spec.purpose);
  if (purposeAmount != null) return purposeAmount;

  if (spec.tools.some((tool) => tool.toolName.includes("refund"))) {
    return 5_000;
  }

  return null;
}

export function buildAgentBuildView(spec: AgentSpec, sentence: string): AgentBuildView {
  return {
    spec,
    trigger: sentence.trim() || spec.summary,
    tools: spec.tools.map((tool) => tool.label),
    suggestedThresholdInr: extractSuggestedThresholdInr(spec),
    sentence: sentence.trim(),
  };
}

const TOOL_LABELS: Record<AgentBuildParseResult["tools"][number], string> = {
  web_search: "Web search",
  send_email: "Send email",
  send_whatsapp_message: "Send WhatsApp message",
  issue_refund: "Issue refund",
  update_crm_record: "Update CRM record",
  delete_crm_record: "Delete CRM record",
  query_database: "Query database",
  create_calendar_event: "Create calendar event",
  create_service_quote: "Create service quote",
  verify_service_address: "Verify service address",
  request_electrician_visit: "Request electrician visit",
  plan_travel_itinerary: "Plan travel itinerary",
  request_travel_booking: "Request travel booking",
  plan_wedding_event: "Plan wedding event",
  request_wedding_deposit: "Request wedding deposit",
  plan_group_outing: "Plan group outing",
  request_group_reservation: "Request group reservation",
};

const TOOL_ACTION_TYPES: Record<AgentBuildParseResult["tools"][number], string> = {
  web_search: "research.web_search",
  send_email: "communication.email",
  send_whatsapp_message: "communication.whatsapp",
  issue_refund: "financial.refund",
  update_crm_record: "crm.update",
  delete_crm_record: "crm.delete",
  query_database: "data.query",
  create_calendar_event: "calendar.create",
  create_service_quote: "service.quote",
  verify_service_address: "service.address_verify",
  request_electrician_visit: "service.appointment_request",
  plan_travel_itinerary: "travel.itinerary",
  request_travel_booking: "travel.booking_request",
  plan_wedding_event: "wedding.plan",
  request_wedding_deposit: "wedding.deposit",
  plan_group_outing: "group.plan",
  request_group_reservation: "group.reservation",
};

const TOOL_ICONS: Record<AgentBuildParseResult["tools"][number], string> = {
  web_search: "🔎",
  send_email: "📧",
  send_whatsapp_message: "💬",
  issue_refund: "💳",
  update_crm_record: "📝",
  delete_crm_record: "🗑️",
  query_database: "🔍",
  create_calendar_event: "📅",
  create_service_quote: "💡",
  verify_service_address: "📍",
  request_electrician_visit: "🔧",
  plan_travel_itinerary: "🗺️",
  request_travel_booking: "🎟️",
  plan_wedding_event: "💍",
  request_wedding_deposit: "💳",
  plan_group_outing: "🍽️",
  request_group_reservation: "📅",
};

function humanizeHyphenName(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildProtectionFromThreshold(
  tools: AgentBuildParseResult["tools"],
  threshold: number
): AgentSpec["protection"] {
  const rules: AgentSpec["protection"] = [];

  if (tools.includes("issue_refund")) {
    rules.push(
      {
        level: "allow",
        label: `Refund up to ₹${threshold.toLocaleString("en-IN")}`,
        description: "Small refunds can happen automatically.",
      },
      {
        level: "review",
        label: `Refund above ₹${threshold.toLocaleString("en-IN")}`,
        description: "You approve larger refunds before they go through.",
      }
    );
  } else {
    rules.push({
      level: "review",
      label: "Important actions",
      description: "Risky actions pause for your approval before they run.",
    });
  }

  rules.push({
    level: "block",
    label: "Delete customer records",
    description: "Customer data cannot be deleted by the agent.",
  });

  return rules;
}

export function buildAgentSpecFromParse(
  parsed: AgentBuildParseResult,
  sentence: string
): AgentSpec {
  const displayName = humanizeHyphenName(parsed.name);

  return {
    name: displayName,
    agentId: slugifyAgentId(parsed.name),
    summary: parsed.description,
    purpose: sentence.trim(),
    tools: parsed.tools.map((toolName) => ({
      id: toolName,
      label: TOOL_LABELS[toolName],
      icon: TOOL_ICONS[toolName],
      toolName,
      actionType: TOOL_ACTION_TYPES[toolName],
    })),
    protection: buildProtectionFromThreshold(parsed.tools, parsed.suggestedThreshold),
    generatedAt: new Date().toISOString(),
    source: "grok",
    model: getGrokModel(),
  };
}

/** @deprecated Use buildAgentSpecFromParse */
export const buildAgentSpecFromGemini = buildAgentSpecFromParse;

export function buildAgentBuildViewFromParse(
  parsed: AgentBuildParseResult,
  sentence: string
): AgentBuildView {
  const spec = buildAgentSpecFromParse(parsed, sentence);
  const view = buildAgentBuildView(spec, sentence);

  return {
    ...view,
    success: true,
    name: parsed.name,
    description: parsed.description,
    triggerType: parsed.triggerType,
    suggestedThreshold: parsed.suggestedThreshold,
    suggestedThresholdInr: parsed.suggestedThreshold,
  };
}

/** @deprecated Use buildAgentBuildViewFromParse */
export const buildAgentBuildViewFromGemini = buildAgentBuildViewFromParse;
