import { buildFallbackAgentBuildParse } from "./fallback-agent-build";
import { AGENT_BUILD_PARSE_ERROR, GrokAgentBuilderError } from "./errors";

export const ALLOWED_AGENT_TOOLS = [
  "web_search",
  "send_email",
  "send_whatsapp_message",
  "issue_refund",
  "update_crm_record",
  "delete_crm_record",
  "query_database",
  "create_calendar_event",
  "create_service_quote",
  "verify_service_address",
  "request_electrician_visit",
  "plan_travel_itinerary",
  "request_travel_booking",
  "plan_wedding_event",
  "request_wedding_deposit",
  "plan_group_outing",
  "request_group_reservation",
] as const;

export type AllowedAgentTool = (typeof ALLOWED_AGENT_TOOLS)[number];

export const ALLOWED_TRIGGER_TYPES = ["email", "webhook", "schedule"] as const;

export type AllowedTriggerType = (typeof ALLOWED_TRIGGER_TYPES)[number];

export interface AgentBuildParseResult {
  name: string;
  description: string;
  tools: AllowedAgentTool[];
  triggerType: AllowedTriggerType;
  suggestedThreshold: number;
}

export const AGENT_BUILD_MIN_SENTENCE_LENGTH = 20;

const ALLOWED_TOOL_SET = new Set<string>(ALLOWED_AGENT_TOOLS);
const ALLOWED_TRIGGER_SET = new Set<string>(ALLOWED_TRIGGER_TYPES);

export function buildAgentBuildPrompt(sentence: string): string {
  return `Parse this sentence into an agent spec. Return ONLY valid JSON with no markdown:
{
  "name": "short lowercase name with hyphens",
  "description": "one sentence what it does",
  "tools": [array of tool names from: web_search, send_email, send_whatsapp_message, issue_refund, update_crm_record, delete_crm_record, query_database, create_calendar_event, create_service_quote, verify_service_address, request_electrician_visit, plan_travel_itinerary, request_travel_booking, plan_wedding_event, request_wedding_deposit, plan_group_outing, request_group_reservation],
  "triggerType": "email|webhook|schedule",
  "suggestedThreshold": integer (e.g., 5000)
}
Sentence: ${sentence}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

export function parseAgentBuildPayload(raw: unknown): AgentBuildParseResult {
  if (!raw || typeof raw !== "object") {
    throw new GrokAgentBuilderError(AGENT_BUILD_PARSE_ERROR);
  }

  const record = raw as Record<string, unknown>;

  if (!isNonEmptyString(record.name)) {
    throw new GrokAgentBuilderError(AGENT_BUILD_PARSE_ERROR);
  }

  if (!isNonEmptyString(record.description)) {
    throw new GrokAgentBuilderError(AGENT_BUILD_PARSE_ERROR);
  }

  if (!Array.isArray(record.tools) || record.tools.length === 0) {
    throw new GrokAgentBuilderError(AGENT_BUILD_PARSE_ERROR);
  }

  const tools = record.tools
    .filter((tool): tool is string => typeof tool === "string")
    .map((tool) => tool.trim())
    .filter((tool) => ALLOWED_TOOL_SET.has(tool)) as AllowedAgentTool[];

  if (tools.length === 0) {
    throw new GrokAgentBuilderError(AGENT_BUILD_PARSE_ERROR);
  }

  if (!isNonEmptyString(record.triggerType)) {
    throw new GrokAgentBuilderError(AGENT_BUILD_PARSE_ERROR);
  }

  const triggerNormalized = record.triggerType.trim().toLowerCase();
  if (!ALLOWED_TRIGGER_SET.has(triggerNormalized)) {
    throw new GrokAgentBuilderError(AGENT_BUILD_PARSE_ERROR);
  }

  if (!isInteger(record.suggestedThreshold)) {
    throw new GrokAgentBuilderError(AGENT_BUILD_PARSE_ERROR);
  }

  if (record.suggestedThreshold <= 0) {
    throw new GrokAgentBuilderError(AGENT_BUILD_PARSE_ERROR);
  }

  return {
    name: record.name.trim(),
    description: record.description.trim(),
    tools,
    triggerType: triggerNormalized as AllowedTriggerType,
    suggestedThreshold: record.suggestedThreshold,
  };
}

export async function generateAgentBuildFromSentence(
  sentence: string,
  options: { minLength?: number } = {}
): Promise<AgentBuildParseResult> {
  const minLength = options.minLength ?? AGENT_BUILD_MIN_SENTENCE_LENGTH;
  const trimmed = sentence.trim();
  if (trimmed.length < minLength) {
    throw new GrokAgentBuilderError(
      `Description must be at least ${minLength} characters.`
    );
  }

  const fallback = buildFallbackAgentBuildParse(trimmed);
  console.log("Parsed spec (fallback):", fallback);
  return fallback;
}
