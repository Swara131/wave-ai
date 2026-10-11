import { groqJsonCompletion } from "@/lib/groq/client";
import { isGroqConfigured } from "@/lib/groq/env";
import { parseJsonText } from "@/lib/groq/json";
import { formatQueryToolReport } from "../analysis/structured-report";
import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";

interface WebSearchResult {
  title?: string;
  url?: string;
  description?: string;
}

export function formatWebSearchSummary(
  results: WebSearchResult[]
): string {
  if (results.length === 0) {
    return "No web results were found for this search.";
  }

  const heading = "Research summary";
  const lines: string[] = [heading, ""];

  results.slice(0, 5).forEach((item, index) => {
    const title = item.title?.trim() || "Untitled result";
    const summary = item.description?.trim() || "No description available.";
    lines.push(`${index + 1}. ${title}`);
    lines.push(summary);
    lines.push("");
  });

  const sources = results
    .map((item) => item.url?.trim())
    .filter(Boolean) as string[];

  if (sources.length > 0) {
    lines.push("Sources:");
    for (const url of sources.slice(0, 5)) {
      lines.push(`- ${url}`);
    }
  }

  return lines.join("\n").trim();
}

export async function summarizeToolResultsForTask(params: {
  task: string;
  agentName: string;
  toolName: string;
  toolOutput: Record<string, unknown>;
  agentRecord?: Pick<
    BuilderAgentRecord,
    "name" | "goal" | "description" | "instructions" | "safetySettings"
  >;
  toolError?: string | null;
}): Promise<string> {
  if (params.toolName === "query_supabase" || params.toolName === "query_database") {
    const agentRecord = params.agentRecord ?? {
      name: params.agentName,
      goal: params.task,
      description: params.task,
      instructions: null,
      safetySettings: {},
    };
    return formatQueryToolReport({
      toolOutput: params.toolOutput,
      agent: agentRecord,
      task: params.task,
      toolError: params.toolError,
    }).text;
  }

  if (params.toolName === "web_search") {
    const tavilyAnswer =
      typeof params.toolOutput.answer === "string"
        ? params.toolOutput.answer.trim()
        : "";

    if (tavilyAnswer.length > 20) {
      const results = Array.isArray(params.toolOutput.results)
        ? (params.toolOutput.results as WebSearchResult[])
        : [];
      const sources = results
        .map((item) => item.url?.trim())
        .filter(Boolean) as string[];

      if (sources.length > 0) {
        const sourceLines = sources
          .slice(0, 5)
          .map((url) => `- ${url}`)
          .join("\n");
        return `${tavilyAnswer}\n\nSources:\n${sourceLines}`.trim();
      }

      return tavilyAnswer;
    }

    const results = Array.isArray(params.toolOutput.results)
      ? (params.toolOutput.results as WebSearchResult[])
      : [];

    if (isGroqConfigured() && results.length > 0) {
      try {
        const prompt = [
          "Summarize these web search results for the user's task.",
          "Return JSON: {\"summary\":\"Markdown with headings, lists or GFM tables, then a Sources list of real URLs from the results only\"}",
          "",
          `Agent: ${params.agentName}`,
          `Task: ${params.task}`,
          "",
          "Search results:",
          JSON.stringify(results.slice(0, 8)),
        ].join("\n");

        const raw = await groqJsonCompletion(prompt, {
          kind: "agent-builder",
          temperature: 0.3,
          system:
            "You write concise, factual summaries from search results. Never invent stories. Only use provided result titles and descriptions.",
        });

        const parsed = parseJsonText(raw) as { summary?: string };
        if (typeof parsed.summary === "string" && parsed.summary.trim().length > 20) {
          return parsed.summary.trim();
        }
      } catch {
        /* fall through to structured formatter */
      }
    }

    return formatWebSearchSummary(results);
  }

  if (isGroqConfigured()) {
    try {
      const prompt = [
        "Summarize this tool output for the user's task as readable Markdown.",
        'Return JSON: {"summary":"clear final answer with headings and lists. Do not dump raw JSON."}',
        "",
        `Task: ${params.task}`,
        `Tool: ${params.toolName}`,
        "Output:",
        JSON.stringify(params.toolOutput).slice(0, 6000),
      ].join("\n");

      const raw = await groqJsonCompletion(prompt, {
        kind: "agent-builder",
        temperature: 0.2,
      });
      const parsed = parseJsonText(raw) as { summary?: string };
      if (typeof parsed.summary === "string" && parsed.summary.trim()) {
        return parsed.summary.trim();
      }
    } catch {
      /* fall through */
    }
  }

  return "The tool returned data, but Wave could not format it as a readable answer.";
}
