import { parseJsonText } from "@/lib/groq/json";
import { geminiJsonCompletion } from "./client";
import { AGENT_BUILD_PARSE_ERROR, GeminiAgentBuilderError } from "./errors";

export const ALLOWED_AGENT_TOOLS = [
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

export interface GeminiAgentBuildResult {
  name: string;
  description: string;
  tools: AllowedAgentTool[];
  triggerType: AllowedTriggerType;
  suggestedThreshold: number;
}

const ALLOWED_TOOL_SET = new Set<string>(ALLOWED_AGENT_TOOLS);
const ALLOWED_TRIGGER_SET = new Set<string>(ALLOWED_TRIGGER_TYPES);

function buildPrompt(sentence: string): string {
  return `Parse this sentence into an agent spec. Return ONLY valid JSON:
{
  "name": "short lowercase name with hyphens",
  "description": "one sentence what it does",
  "tools": [array of tool names from: send_email, send_whatsapp_message, issue_refund, update_crm_record, query_database, create_calendar_event, plan_wedding_event, request_wedding_deposit, plan_group_outing, request_group_reservation],
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

export function parseGeminiAgentBuildPayload(raw: unknown): GeminiAgentBuildResult {
  if (!raw || typeof raw !== "object") {
    throw new GeminiAgentBuilderError(AGENT_BUILD_PARSE_ERROR);
  }

  const record = raw as Record<string, unknown>;

  if (!isNonEmptyString(record.name)) {
    throw new GeminiAgentBuilderError(AGENT_BUILD_PARSE_ERROR);
  }

  if (!isNonEmptyString(record.description)) {
    throw new GeminiAgentBuilderError(AGENT_BUILD_PARSE_ERROR);
  }

  if (!Array.isArray(record.tools) || record.tools.length === 0) {
    throw new GeminiAgentBuilderError(AGENT_BUILD_PARSE_ERROR);
  }

  const tools = record.tools
    .filter((tool): tool is string => typeof tool === "string")
    .map((tool) => tool.trim())
    .filter((tool) => ALLOWED_TOOL_SET.has(tool)) as AllowedAgentTool[];

  if (tools.length === 0) {
    throw new GeminiAgentBuilderError(AGENT_BUILD_PARSE_ERROR);
  }

  if (
    !isNonEmptyString(record.triggerType) ||
    !ALLOWED_TRIGGER_SET.has(record.triggerType.trim())
  ) {
    throw new GeminiAgentBuilderError(AGENT_BUILD_PARSE_ERROR);
  }

  if (!isInteger(record.suggestedThreshold)) {
    throw new GeminiAgentBuilderError(AGENT_BUILD_PARSE_ERROR);
  }

  return {
    name: record.name.trim(),
    description: record.description.trim(),
    tools,
    triggerType: record.triggerType.trim() as AllowedTriggerType,
    suggestedThreshold: record.suggestedThreshold,
  };
}

export async function generateAgentBuildFromSentence(
  sentence: string
): Promise<GeminiAgentBuildResult> {
  const trimmed = sentence.trim();
  if (trimmed.length < 10) {
    throw new GeminiAgentBuilderError(
      "Describe what your agent should do in a bit more detail."
    );
  }

  const rawText = await geminiJsonCompletion(buildPrompt(trimmed));

  try {
    const parsed = parseJsonText(rawText);
    return parseGeminiAgentBuildPayload(parsed);
  } catch (err) {
    if (err instanceof GeminiAgentBuilderError) {
      throw err;
    }
    throw new GeminiAgentBuilderError(AGENT_BUILD_PARSE_ERROR);
  }
}
