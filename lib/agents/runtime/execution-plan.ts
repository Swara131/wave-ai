import { parseDeliverySettings } from "@/lib/agents/delivery/settings";
import { extractHttpUrl } from "@/lib/http/outbound-url";
import { activeWorkflowGraph, readWorkflowState } from "@/lib/agents/workflow/persistence";
import type { AgentWorkflowGraph } from "@/lib/agents/workflow/types";
import type { AgentSafetySettings, BuilderAgentRecord } from "@/lib/agents/runtime-types";
export { matchWorkflowNodeToStep } from "@/lib/agents/workflow/run-status";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SKIP_SETUP_KEYS = new Set([
  "output",
  "output_destination",
  "research",
  "safety",
  "crm_policy",
  "company_source",
  "contact_source",
  "briefing_contents",
  "briefing_length",
  "briefing_format",
  "story_count",
  "summary_length",
  "venue_photo",
  "venue_notes",
  "research_depth",
  "research_company",
  "research_contact",
]);

export interface WorkflowPlanStep {
  id: string;
  name: string;
  description: string;
  toolName?: string;
  category: string;
  type: string;
}

export function workflowPlanFromGraph(graph: AgentWorkflowGraph | null | undefined): WorkflowPlanStep[] {
  if (!graph?.nodes?.length) return [];
  return [...graph.nodes]
    .sort((a, b) => a.position - b.position)
    .map((node) => ({
      id: node.id,
      name: node.name,
      description: node.description,
      toolName: node.config?.toolName ?? (node.type === "output_email" ? "send_email" : undefined),
      category: node.category,
      type: node.type,
    }));
}

export function workflowGraphFromAgent(agent: {
  safetySettings?: AgentSafetySettings | null;
}): AgentWorkflowGraph | null {
  return activeWorkflowGraph(readWorkflowState(agent.safetySettings));
}

export function setupAnswersFromAgent(agent: {
  safetySettings?: AgentSafetySettings | null;
}): Record<string, string> {
  const answers = {
    ...(agent.safetySettings?.requirementChoices ?? {}),
    ...(agent.safetySettings?.setupAnswers ?? {}),
  };
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (!value?.trim() || SKIP_SETUP_KEYS.has(key)) continue;
    cleaned[key] = value.trim();
  }
  return cleaned;
}

export function formatSetupAnswersForPrompt(answers: Record<string, string>): string {
  return Object.entries(answers)
    .map(([key, value]) => `- ${key.replace(/_/g, " ")}: ${value}`)
    .join("\n");
}

export function deriveExecutableTaskFromSetup(params: {
  goal?: string | null;
  description?: string | null;
  setupAnswers?: Record<string, string>;
  userTask?: string | null;
}): string {
  const base =
    params.userTask?.trim() ||
    params.goal?.trim() ||
    params.description?.trim() ||
    "Run this agent using the saved configuration.";

  const stripped = base
    .replace(/^create an agent that\s*/i, "")
    .replace(/^build an agent to\s*/i, "")
    .replace(/^make an agent that\s*/i, "")
    .trim();

  const sourceUrl =
    params.setupAnswers?.source_url?.trim() || extractHttpUrl(stripped) || "";
  const withUrl = sourceUrl
    ? `${stripped.endsWith(".") ? stripped : `${stripped}.`} Source URL: ${sourceUrl}. Fetch that link and summarize only content that was actually retrieved. If the page or transcript cannot be read, say so. Do not invent tickets, quotes, or facts.`
    : stripped.endsWith(".")
      ? stripped
      : `${stripped}.`;
  return withUrl;
}

export function mergeRunInputsIntoAgent(
  agent: BuilderAgentRecord,
  runInputs: Record<string, string> | undefined
): BuilderAgentRecord {
  if (!runInputs || Object.keys(runInputs).length === 0) return agent;
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(runInputs)) {
    if (value?.trim()) cleaned[key] = value.trim();
  }
  if (Object.keys(cleaned).length === 0) return agent;
  return {
    ...agent,
    safetySettings: {
      ...agent.safetySettings,
      setupAnswers: {
        ...(agent.safetySettings?.setupAnswers ?? {}),
        ...cleaned,
      },
    },
  };
}

export function buildRuntimePlanPrompt(params: {
  workflowPlan: WorkflowPlanStep[];
  setupAnswers: Record<string, string>;
}): string {
  const parts: string[] = [];
  if (params.workflowPlan.length > 0) {
    parts.push(
      "Follow this workflow in order. Do not skip a real tool step. Do not invent steps that are not listed:",
      ...params.workflowPlan.map(
        (step, index) =>
          `${index + 1}. ${step.name}${step.toolName ? ` (tool: ${step.toolName})` : ""} — ${step.description}`
      )
    );
  }
  const setup = formatSetupAnswersForPrompt(params.setupAnswers);
  if (setup) {
    parts.push("", "Saved configuration for this agent:", setup);
  }
  parts.push(
    "",
    "Use only these configured facts. If a required business input is missing, ask for it instead of inventing it."
  );
  return parts.join("\n");
}

export function planFromBuilderAgent(agent: BuilderAgentRecord): {
  workflowPlan: WorkflowPlanStep[];
  setupAnswers: Record<string, string>;
  graph: AgentWorkflowGraph | null;
} {
  const graph = workflowGraphFromAgent(agent);
  return {
    graph,
    workflowPlan: workflowPlanFromGraph(graph),
    setupAnswers: setupAnswersFromAgent(agent),
  };
}

export function destinationEmailFromAgent(agent: {
  safetySettings?: AgentSafetySettings | null;
}): string | null {
  const answers = setupAnswersFromAgent(agent);
  const fromAnswers = answers.email || answers.destinationEmail;
  if (fromAnswers && EMAIL_PATTERN.test(fromAnswers)) return fromAnswers;
  const delivery = parseDeliverySettings(agent.safetySettings);
  const configured = delivery.destinationEmail?.trim();
  if (configured && EMAIL_PATTERN.test(configured)) return configured;
  return null;
}

export function destinationPhoneFromAgent(agent: {
  safetySettings?: AgentSafetySettings | null;
}): string | null {
  const answers = setupAnswersFromAgent(agent);
  return (
    answers.whatsapp ||
    answers.phone ||
    answers.destinationPhone ||
    parseDeliverySettings(agent.safetySettings).destinationPhone ||
    null
  );
}
