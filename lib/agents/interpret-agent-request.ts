import { GrokAgentBuilderError } from "@/lib/xai/errors";
import { buildFallbackAgentBuildParse } from "@/lib/xai/fallback-agent-build";
import type { AllowedTriggerType } from "@/lib/xai/parse-agent-build";
import {
  capabilityIdsToTools,
  capabilityToEntries,
  inferCapabilityIdsFromText,
} from "./builder-capabilities";
import { inferDeliveryModeFromText } from "./delivery/infer-delivery";
import type { AgentInterpretation } from "./builder-types";
import type { AgentScheduleConfig } from "./runtime-types";

const PROTECTION_SUMMARY =
  "Wave checks important actions before they happen.";

function displayNameFromSlug(slug: string): string {
  const words = slug
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));

  const base = words.join(" ");
  if (/agent$/i.test(base)) return base;
  return `${base} Agent`;
}

function parseTimeFromText(text: string): string {
  const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!match) return "09:00";

  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase();

  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function inferScheduleFromText(text: string): {
  summary: string;
  schedule: AgentScheduleConfig;
  triggerType: AllowedTriggerType;
} {
  const normalized = text.toLowerCase();

  if (/\bevery morning\b|\beach morning\b|\bmorning\b/.test(normalized)) {
    const time = parseTimeFromText(text);
    const displayTime = formatDisplayTime(time);
    return {
      summary: `Every morning at ${displayTime}`,
      schedule: { when: "daily", time, triggerType: "schedule" },
      triggerType: "schedule",
    };
  }

  if (/\bdaily\b|\bevery day\b/.test(normalized)) {
    const time = parseTimeFromText(text);
    return {
      summary: `Daily at ${formatDisplayTime(time)}`,
      schedule: { when: "daily", time, triggerType: "schedule" },
      triggerType: "schedule",
    };
  }

  if (/\bweekly\b|\bevery week\b|\bmonday\b|\bfriday\b/.test(normalized)) {
    return {
      summary: "Weekly on your chosen days",
      schedule: { when: "weekly", days: ["monday"], triggerType: "schedule" },
      triggerType: "schedule",
    };
  }

  if (/\bemail\b|\bwhen i get\b|\binbox\b/.test(normalized)) {
    return {
      summary: "When a new email arrives",
      schedule: { when: "on_event", triggerType: "email" },
      triggerType: "email",
    };
  }

  return {
    summary: "When you ask it to run",
    schedule: { when: "manual", triggerType: "webhook" },
    triggerType: "webhook",
  };
}

function formatDisplayTime(time24: string): string {
  const [hourPart, minutePart] = time24.split(":");
  const hours = Number(hourPart);
  const minutes = Number(minutePart);
  const meridiem = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${meridiem}`;
}

function inferDisplayName(text: string, slugName: string): string {
  const normalized = text.toLowerCase();
  if (/\b(x|twitter)\b/.test(normalized) && /\bfounder\b/.test(normalized)) {
    return "Founder Engagement Agent";
  }
  if (/\brefund\b/.test(normalized)) return "Refund Assistant Agent";
  if (/\b(youtube|youtu\.be)\b/.test(normalized)) {
    return "YouTube Summary Agent";
  }
  if (/\bnews\b/.test(normalized) && /\b(ai|artificial intelligence)\b/.test(normalized)) {
    return "AI News Agent";
  }
  if (/\bemail\b/.test(normalized)) return "Email Assistant Agent";
  return displayNameFromSlug(slugName);
}

function refineGoal(text: string, fallbackGoal: string): string {
  const normalized = text.toLowerCase();
  if (/\b(x|twitter)\b/.test(normalized) && /\bfounder\b/.test(normalized)) {
    return "Finds relevant AI founder posts on X and prepares thoughtful replies every morning.";
  }
  if (/\b(youtube|youtu\.be)\b/.test(normalized)) {
    return "Reads a YouTube or other public link you provide and summarizes only the content Wave can actually fetch.";
  }
  if (/\bnews\b/.test(normalized) && /\b(ai|artificial intelligence)\b/.test(normalized)) {
    return "Finds the latest AI news each morning and delivers a short summary.";
  }
  return fallbackGoal;
}

export function buildFallbackInterpretation(description: string): AgentInterpretation {
  const trimmed = description.trim();
  const parsed = buildFallbackAgentBuildParse(trimmed);
  const schedule = inferScheduleFromText(trimmed);
  const capabilityIds = inferCapabilityIdsFromText(trimmed);
  const toolsFromCapabilities = capabilityIdsToTools(capabilityIds);
  const tools =
    toolsFromCapabilities.length > 0
      ? toolsFromCapabilities
      : parsed.tools.length > 0
        ? [...parsed.tools]
        : ["web_search"];

  return {
    displayName: inferDisplayName(trimmed, parsed.name),
    goal: refineGoal(trimmed, parsed.description),
    instructions: `Focus on: ${parsed.description} Keep responses helpful, accurate, and ready for your review before anything is sent.`,
    scheduleSummary: schedule.summary,
    schedule: schedule.schedule,
    timezone: "UTC",
    capabilityIds,
    capabilities: capabilityToEntries(capabilityIds),
    tools,
    protectionSummary: PROTECTION_SUMMARY,
    triggerType: schedule.triggerType,
    suggestedThreshold: parsed.suggestedThreshold,
    originalDescription: trimmed,
    deliveryMode: inferDeliveryModeFromText(trimmed),
  };
}

export async function interpretAgentRequest(
  description: string,
  options: { minLength?: number } = {}
): Promise<AgentInterpretation> {
  const minLength = options.minLength ?? 15;
  const trimmed = description.trim();

  if (trimmed.length < minLength) {
    throw new GrokAgentBuilderError(
      `Description must be at least ${minLength} characters.`
    );
  }

  return buildFallbackInterpretation(trimmed);
}
