import { parseJsonText } from "@/lib/groq/json";
import type { SourceImage } from "@/lib/agents/runtime/source-image";
import { GeminiAgentBuilderError } from "./errors";
import { getGeminiClient } from "./client";
import { getGeminiModel } from "./env";

export async function geminiVisionJson(params: {
  system: string;
  prompt: string;
  image: SourceImage;
}): Promise<unknown> {
  const model = getGeminiClient().getGenerativeModel({
    model: getGeminiModel(),
    systemInstruction: params.system,
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
    },
  });

  const result = await model.generateContent([
    { text: params.prompt },
    {
      inlineData: {
        mimeType: params.image.mimeType,
        data: params.image.base64,
      },
    },
  ]);
  const text = result.response.text()?.trim();
  if (!text) {
    throw new GeminiAgentBuilderError("Gemini vision returned an empty response.");
  }
  try {
    return parseJsonText(text);
  } catch {
    return { summary: text, concepts: [] };
  }
}
