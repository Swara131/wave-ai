import { setupAnswersFromAgent } from "../execution-plan";
import type { LoadedAgent } from "../types";

const RESEARCH_PATTERNS =
  /\b(news|headlines|research|look up|lookup|find\b|search\b|latest|monitor|track|scan|summarize|report|competitor|morning|daily brief|what'?s new)\b/i;

const PROMPT_ECHO_PREFIX = /^completed:\s*/i;

export function taskNeedsWebResearch(task: string, agent: LoadedAgent): boolean {
  const combined = `${task} ${agent.record.goal ?? ""} ${agent.record.instructions ?? ""}`;
  if (!RESEARCH_PATTERNS.test(combined)) {
    return false;
  }
  return agent.enabledTools.includes("web_search");
}

export function deriveWebSearchQuery(task: string, agent: LoadedAgent): string {
  const answers = setupAnswersFromAgent(agent.record);
  const topic =
    answers.topics ||
    answers.topic ||
    answers.news_topics ||
    answers.content_topics ||
    answers.company_name;
  if (topic) {
    return `${topic} ${task.slice(0, 80)}`.trim().slice(0, 160);
  }

  const cleaned = `${task} ${agent.record.goal ?? ""}`
    .replace(/^(create an agent that|build an agent to|run my agent:?)\s*/i, "")
    .replace(/\b(every morning|daily|by email|on email|send me|short summary)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.slice(0, 160) || agent.record.goal?.slice(0, 160) || "latest relevant updates";
}

export function deriveExecutableTestTask(
  goal: string | null | undefined,
  description: string | null | undefined
): string {
  const raw = goal?.trim() || description?.trim() || "Run a quick test of my agent.";

  const stripped = raw
    .replace(/^create an agent that\s*/i, "")
    .replace(/^build an agent to\s*/i, "")
    .replace(/^make an agent that\s*/i, "")
    .trim();

  if (stripped.length >= 12) {
    return stripped.endsWith(".") ? stripped : `${stripped}.`;
  }

  return raw;
}

export function isFailureCompleteMessage(message: string): boolean {
  return (
    /could not complete|not configured|no ai model|unable to complete|web research isn't connected|could not run automatically|the ai model could not run|add groq_api_key/i.test(
      message
    )
  );
}

export function isPromptEcho(message: string, task: string): boolean {
  const normalizedMessage = message.trim();
  const normalizedTask = task.trim();

  if (!normalizedMessage || !normalizedTask) {
    return false;
  }

  if (PROMPT_ECHO_PREFIX.test(normalizedMessage)) {
    const body = normalizedMessage.replace(PROMPT_ECHO_PREFIX, "").trim();
    if (
      body === normalizedTask ||
      normalizedTask.toLowerCase().includes(body.toLowerCase()) ||
      body.toLowerCase().includes(normalizedTask.toLowerCase())
    ) {
      return true;
    }
  }

  if (/use this saved configuration/i.test(normalizedMessage)) {
    return true;
  }

  if (normalizedMessage.toLowerCase() === normalizedTask.toLowerCase()) {
    return true;
  }

  if (
    normalizedMessage.length >= normalizedTask.length * 0.85 &&
    normalizedMessage.toLowerCase().includes(normalizedTask.toLowerCase().slice(0, 40))
  ) {
    return true;
  }

  return false;
}

export function toolStepLabel(
  toolName: string,
  phase: "before" | "after" | "failed"
): { label: string; detail?: string } {
  switch (toolName) {
    case "web_search":
      if (phase === "before") {
        return { label: "Searching the web", detail: "Finding relevant results" };
      }
      if (phase === "after") {
        return { label: "Reading search results", detail: "Analyzing what was found" };
      }
      return { label: "Web search unavailable", detail: "Could not search the web" };
    case "x_search":
      return phase === "before"
        ? { label: "Searching X", detail: "Finding recent posts" }
        : { label: "Analyzing X results" };
    case "read_document":
      return phase === "before"
        ? { label: "Reading documents", detail: "Loading file content" }
        : { label: "Analyzing documents" };
    case "query_supabase":
      return phase === "before"
        ? { label: "Looking up your data", detail: "Querying workspace records" }
        : { label: "Analyzing records" };
    case "send_email":
      return phase === "before"
        ? { label: "Preparing email", detail: "Drafting message" }
        : { label: "Email step finished" };
    default:
      return phase === "before"
        ? { label: `Running ${toolName.replace(/_/g, " ")}` }
        : { label: `Finished ${toolName.replace(/_/g, " ")}` };
  }
}
