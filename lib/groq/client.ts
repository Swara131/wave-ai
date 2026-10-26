import Groq from "groq-sdk";
import {
  AiProposalEnrichmentError,
  AiRiskAnalysisError,
  AiTranslationError,
  AiAgentBuilderError,
  formatGroqError,
} from "./errors";
import { getGroqApiKey, getGroqModel, getGroqVisionModels } from "./env";

let groqClient: Groq | undefined;

export function getGroqClient(): Groq {
  if (!groqClient) {
    groqClient = new Groq({ apiKey: getGroqApiKey() });
  }
  return groqClient;
}

/**
 * Server-only JSON completion via Groq chat API.
 * Never import this module from client components.
 */
export async function groqJsonCompletion(
  prompt: string,
  options?: { system?: string; kind?: "translation" | "risk" | "proposal" | "agent-builder"; temperature?: number }
): Promise<string> {
  const kind = options?.kind ?? "translation";
  const groq = getGroqClient();

  const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (options?.system) {
    messages.push({ role: "system", content: options.system });
  }
  messages.push({ role: "user", content: prompt });

  try {
    const response = await groq.chat.completions.create({
      model: getGroqModel(),
      messages,
      temperature: options?.temperature ?? 0.2,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      if (kind === "proposal") {
        throw new AiProposalEnrichmentError("Groq returned an empty response.");
      }
      if (kind === "agent-builder") {
        throw new AiAgentBuilderError("Groq returned an empty response.");
      }
      throw kind === "risk"
        ? new AiRiskAnalysisError("Groq returned an empty response.")
        : new AiTranslationError("Groq returned an empty response.");
    }

    return content;
  } catch (err) {
    throw formatGroqError(err, kind);
  }
}

export async function groqVisionJsonCompletion(params: {
  system: string;
  prompt: string;
  mimeType: string;
  base64: string;
  temperature?: number;
}): Promise<string> {
  const groq = getGroqClient();
  const dataUrl = `data:${params.mimeType};base64,${params.base64}`;

  let lastError: unknown;
  for (const model of getGroqVisionModels()) {
    try {
      const response = await groq.chat.completions.create({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `${params.system}\n\n${params.prompt}` },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: params.temperature ?? 0.2,
        max_completion_tokens: 2048,
      });
      const message = response.choices[0]?.message;
      const content =
        message?.content?.trim() ||
        (typeof (message as { reasoning?: string } | undefined)?.reasoning === "string"
          ? (message as { reasoning?: string }).reasoning?.trim()
          : "");
      if (content) return content;
      lastError = new AiAgentBuilderError("Groq vision returned an empty response.");
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[runtime] Groq vision model failed:", model, message.slice(0, 240));
    }
  }
  throw formatGroqError(lastError, "agent-builder");
}
