import { isGroqConfigured } from "@/lib/groq/env";
import {
  parseDeliverySettings,
  shouldBlockExternalDeliveryTools,
} from "@/lib/agents/delivery/settings";
import {
  destinationEmailFromAgent,
  destinationPhoneFromAgent,
  setupAnswersFromAgent,
} from "../execution-plan";
import { extractHttpUrl } from "@/lib/http/outbound-url";
import { resolveDatabaseQueryInput, taskNeedsRecordLookup } from "../data/resolve-query-source";
import type { ModelCompletionRequest, ModelTurn } from "../types";
import { summarizeToolResultsForTask } from "./summarize-results";
import {
  deriveWebSearchQuery,
  taskNeedsWebResearch,
} from "./task-intent";

function parseToolResultContent(content: string): {
  executed: boolean;
  output: Record<string, unknown>;
  error?: string | null;
} | null {
  try {
    const parsed = JSON.parse(content) as {
      executed?: boolean;
      output?: Record<string, unknown>;
      error?: string | null;
    };
    if (typeof parsed !== "object" || parsed === null) return null;
    return {
      executed: Boolean(parsed.executed),
      output: parsed.output ?? {},
      error: parsed.error ?? null,
    };
  } catch {
    return null;
  }
}

function lastToolExchange(messages: ModelCompletionRequest["messages"]): {
  toolName: string | null;
  result: ReturnType<typeof parseToolResultContent>;
} {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  const toolMessage = [...messages].reverse().find((message) => message.role === "tool");

  if (!toolMessage) {
    return { toolName: null, result: null };
  }

  let toolName: string | null = null;
  if (assistant?.content) {
    try {
      const parsed = JSON.parse(assistant.content) as { toolName?: string };
      toolName = typeof parsed.toolName === "string" ? parsed.toolName : null;
    } catch {
      toolName = null;
    }
  }

  return {
    toolName,
    result: parseToolResultContent(toolMessage.content),
  };
}

/**
 * Execution-aware fallback when Groq is unavailable — uses Tavily web search for research.
 * Performs real tool calls (e.g. web_search) and summarizes actual results.
 */
function buildFallbackUnavailableMessage(
  request: ModelCompletionRequest,
  groqError?: string
): string {
  const tools =
    request.enabledToolNames.length > 0
      ? request.enabledToolNames.join(", ")
      : "none";

  if (groqError) {
    return `The AI model could not run this task (${groqError}). Your agent has these tools enabled: ${tools}. Restart the dev server after updating .env.local, or check your Groq API key at https://console.groq.com/keys.`;
  }

  if (!isGroqConfigured()) {
    return `Add GROQ_API_KEY to .env.local and restart the dev server to run agents with AI orchestration. Enabled tools: ${tools}.`;
  }

  return `This test could not run automatically with the enabled tools (${tools}). Try Run Full Test again, or check server logs for details.`;
}

export async function fallbackModelTurn(
  request: ModelCompletionRequest,
  groqError?: string
): Promise<ModelTurn> {
  const { toolName, result: lastResult } = lastToolExchange(request.messages);

  if (lastResult && toolName) {
    if (!lastResult.executed) {
      return {
        type: "complete",
        message: lastResult.error ?? "The required tool could not run.",
        reasoning: "Tool execution failed.",
      };
    }

    const summary = await summarizeToolResultsForTask({
      task: request.task,
      agentName: request.agent.record.name,
      toolName,
      toolOutput: lastResult.output,
      agentRecord: request.agent.record,
      toolError: lastResult.error,
    });

    return {
      type: "complete",
      message: summary,
      reasoning: "Summarized real tool output.",
    };
  }

  const sourceUrl =
    setupAnswersFromAgent(request.agent.record).source_url ||
    extractHttpUrl(request.task) ||
    "";

  if (request.enabledToolNames.includes("fetch_url")) {
    if (!sourceUrl) {
      return {
        type: "complete",
        message:
          "Paste a public YouTube, article, or other page URL so Wave can read it. Wave will not invent a summary without that link.",
        reasoning: "Missing source URL for fetch_url.",
      };
    }
    return {
      type: "tool_call",
      toolName: "fetch_url",
      actionType: "research.fetch_url",
      toolInput: { url: sourceUrl },
      reasoning: "Need the real page or video content before summarizing.",
    };
  }

  if (
    request.enabledToolNames.includes("web_search") &&
    taskNeedsWebResearch(request.task, request.agent)
  ) {
    const query = deriveWebSearchQuery(request.task, request.agent);
    return {
      type: "tool_call",
      toolName: "web_search",
      actionType: "research.web_search",
      toolInput: { query, count: 5 },
      reasoning: "Research task requires live web results before summarizing.",
    };
  }

  if (
    request.enabledToolNames.includes("query_supabase") &&
    taskNeedsRecordLookup(request.task, request.agent)
  ) {
    return {
      type: "tool_call",
      toolName: "query_supabase",
      actionType: "data.query",
      toolInput: resolveDatabaseQueryInput({
        agent: request.agent,
        task: request.task,
      }),
      reasoning: "This task needs records from the configured database before a result can be produced.",
    };
  }

  const deliveryMode = parseDeliverySettings(request.agent.record.safetySettings).mode;
  const blockExternalDelivery = shouldBlockExternalDeliveryTools(deliveryMode);

  if (
    !blockExternalDelivery &&
    request.enabledToolNames.includes("send_whatsapp_message") &&
    /\bwhatsapp\b/i.test(request.task)
  ) {
    const to = destinationPhoneFromAgent(request.agent.record);
    if (!to) {
      return {
        type: "complete",
        message:
          "WhatsApp delivery isn't configured yet. Add a recipient number in Prepare your agent.",
        reasoning: "Missing WhatsApp destination.",
      };
    }
    return {
      type: "tool_call",
      toolName: "send_whatsapp_message",
      actionType: "communication.whatsapp",
      toolInput: {
        to,
        message: request.task.slice(0, 500),
      },
      reasoning: "Messaging task selected send_whatsapp_message.",
    };
  }

  if (
    !blockExternalDelivery &&
    request.enabledToolNames.includes("send_email") &&
    /\b(email|mail)\b/i.test(request.task) &&
    !request.enabledToolNames.includes("web_search")
  ) {
    const to = destinationEmailFromAgent(request.agent.record);
    if (!to) {
      return {
        type: "complete",
        message:
          "Email delivery isn't configured yet. Add a recipient in Prepare your agent.",
        reasoning: "Missing email destination.",
      };
    }
    return {
      type: "tool_call",
      toolName: "send_email",
      actionType: "communication.email",
      toolInput: {
        to,
        subject: `${request.agent.record.name} result`,
        message: request.task.slice(0, 500),
      },
      reasoning: "Email task selected send_email using the saved recipient.",
    };
  }

  if (request.enabledToolNames.includes("web_search")) {
    return {
      type: "tool_call",
      toolName: "web_search",
      actionType: "research.web_search",
      toolInput: {
        query: deriveWebSearchQuery(request.task, request.agent),
        count: 5,
      },
      reasoning: "Gathering web data before answering.",
    };
  }

  if (request.enabledToolNames.includes("query_supabase")) {
    return {
      type: "tool_call",
      toolName: "query_supabase",
      actionType: "data.query",
      toolInput: resolveDatabaseQueryInput({
        agent: request.agent,
        task: request.task,
      }),
      reasoning: "Reading configured workspace records before completing the task.",
    };
  }

  if (request.enabledToolNames.includes("read_document")) {
    return {
      type: "tool_call",
      toolName: "read_document",
      actionType: "integration.read_document",
      toolInput: { documentId: "latest" },
      reasoning: "Reading uploaded documents referenced by the task.",
    };
  }

  if (request.enabledToolNames.includes("http_request") && sourceUrl) {
    return {
      type: "tool_call",
      toolName: "http_request",
      actionType: "integration.http",
      toolInput: { url: sourceUrl, method: "GET" },
      reasoning: "Fetching the provided URL.",
    };
  }

  return {
    type: "complete",
    message: buildFallbackUnavailableMessage(request, groqError),
    reasoning: groqError
      ? "Groq unavailable; no fallback tool path matched."
      : "No model provider and no fallback tool path matched.",
  };
}
