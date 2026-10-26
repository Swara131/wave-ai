import { groqJsonCompletion } from "@/lib/groq/client";
import { getGroqModel } from "@/lib/groq/env";
import { parseJsonText } from "@/lib/groq/json";
import type {
  ModelCompletionRequest,
  ModelMessage,
  ModelToolCallTurn,
  ModelTurn,
} from "../types";

function buildTurnPrompt(request: ModelCompletionRequest): string {
  const toolLines = request.enabledToolNames.map((name) => `- ${name}`).join("\n");

  return [
    "Execute the user's task using real tools when needed.",
    "",
    "Task:",
    request.task,
    "",
    "Enabled tools:",
    toolLines || "(none)",
    "",
    "Conversation so far:",
    JSON.stringify(request.messages.slice(-10)),
    "",
    "Return the next JSON turn only:",
    '{"type":"complete","message":"final deliverable for the user","reasoning":"optional"}',
    'or {"type":"tool_call","toolName":"tool_id","toolInput":{},"actionType":"optional","reasoning":"why"}',
    "",
    "Rules:",
    "- Use tool_call when you need fresh data (news, research, links, email, files, database records, tickets).",
    "- If fetch_url is enabled, call it with the provided source URL before writing a summary. If no URL was provided, ask for one — do not invent a page or video.",
    "- For ticket, incident, or evidence tasks, call query_supabase against the ticket source. Never query the agents table for that work.",
    "- Never repeat the task, saved configuration, or say Completed: ... as your final answer.",
    "- After tool results arrive, write the actual deliverable (summary, report, list).",
    "- Never invent ticket IDs, evidence, or findings that were not returned by tools.",
    "- Format complete.message as Markdown (headings, lists, GFM tables with a --- separator row).",
    "- End with a Sources list only when the tools provided real URLs. Never invent links or facts.",
  ].join("\n");
}

function parseModelTurn(raw: unknown): ModelTurn {
  if (!raw || typeof raw !== "object") {
    throw new Error("Model returned invalid JSON.");
  }

  const record = raw as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";

  if (type === "complete") {
    const message = typeof record.message === "string" ? record.message.trim() : "";
    if (!message) throw new Error("Complete turn missing message.");
    return {
      type: "complete",
      message,
      reasoning: typeof record.reasoning === "string" ? record.reasoning : undefined,
    };
  }

  if (type === "tool_call") {
    const toolName = typeof record.toolName === "string" ? record.toolName.trim() : "";
    if (!toolName) throw new Error("Tool call missing toolName.");

    const toolInput =
      record.toolInput && typeof record.toolInput === "object" && !Array.isArray(record.toolInput)
        ? (record.toolInput as Record<string, unknown>)
        : {};

    return {
      type: "tool_call",
      toolName,
      toolInput,
      actionType: typeof record.actionType === "string" ? record.actionType : undefined,
      reasoning: typeof record.reasoning === "string" ? record.reasoning : undefined,
    } satisfies ModelToolCallTurn;
  }

  throw new Error(`Unknown model turn type: ${type || "missing"}`);
}

export async function groqModelTurn(
  request: ModelCompletionRequest
): Promise<ModelTurn> {
  const messages: ModelMessage[] = request.messages;
  const conversation =
    messages.length > 0
      ? messages
          .slice(-8)
          .map((message) => `${message.role}: ${message.content}`)
          .join("\n")
      : "(none)";

  const prompt = [
    buildTurnPrompt(request),
    "",
    "Formatted conversation:",
    conversation,
  ].join("\n");

  const raw = await groqJsonCompletion(prompt, {
    kind: "agent-builder",
    temperature: 0.25,
    system: request.agent.systemPrompt,
  });

  return parseModelTurn(parseJsonText(raw));
}

export function resolveGroqRuntimeModel(): string {
  return getGroqModel();
}
