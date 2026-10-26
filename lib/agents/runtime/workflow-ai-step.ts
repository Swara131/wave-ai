import { groqJsonCompletion, groqVisionJsonCompletion } from "@/lib/groq/client";
import { isGroqConfigured } from "@/lib/groq/env";
import { parseJsonText } from "@/lib/groq/json";
import { isGeminiConfigured } from "@/lib/gemini/env";
import { geminiVisionJson } from "@/lib/gemini/vision";
import { generateConceptImages, type GeneratedImageBatch } from "./generate-concept-images";
import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";
import { setupAnswersFromAgent } from "./execution-plan";
import type { SourceImage } from "./source-image";
import type { ConceptImage, ConceptPrompt } from "./concept-image";
import { parseImageGenOptions, type ImageGenOptions } from "@/lib/images/types";
import { buildDirectorImagePrompt } from "@/lib/images/director-prompt";

export interface AiWorkflowStepDeps {
  groqConfigured: boolean;
  geminiConfigured?: boolean;
  completeJson: (system: string, prompt: string) => Promise<unknown>;
  completeVisionJson?: (
    system: string,
    prompt: string,
    image: SourceImage
  ) => Promise<unknown>;
  generateImages?: (
    image: SourceImage,
    concepts: ConceptPrompt[],
    options: ImageGenOptions,
    extras: { scene: string; notes?: string }
  ) => Promise<GeneratedImageBatch | ConceptImage[]>;
}

export interface AiWorkflowStepResult {
  summary: string;
  conceptPrompts: ConceptPrompt[];
  conceptImages: ConceptImage[];
  generationError?: string;
  generationProvider?: string;
  generationModel?: string;
  generationErrorKind?: string;
  generationRetryable?: boolean;
}

function parseVisionPayload(parsed: unknown, rawText?: string): {
  summary: string;
  conceptPrompts: ConceptPrompt[];
} {
  const row = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const summary =
    (typeof row.summary === "string" && row.summary.trim()) ||
    (rawText && rawText.trim().length >= 40 ? rawText.trim() : "");
  const conceptsRaw = Array.isArray(row.concepts) ? row.concepts : [];
  const conceptPrompts: ConceptPrompt[] = [];
  for (const item of conceptsRaw) {
    if (!item || typeof item !== "object") continue;
    const rowItem = item as Record<string, unknown>;
    const title = typeof rowItem.title === "string" ? rowItem.title.trim() : "";
    const prompt = typeof rowItem.prompt === "string" ? rowItem.prompt.trim() : "";
    if (title && prompt) conceptPrompts.push({ title: title.slice(0, 80), prompt });
  }
  return { summary, conceptPrompts };
}

function defaultConceptPrompts(task: string): ConceptPrompt[] {
  return [
    {
      title: "Daytime styling",
      prompt: `Photorealistic event styling of this exact location. ${task}. Keep the real viewpoint and scenery. Add only tasteful seating and florals that fit what is already there.`,
    },
    {
      title: "Evening lighting",
      prompt: "Photorealistic evening version of this exact location with warm string lights and a simple dining setup that matches the existing scenery. Do not change the place into a different venue.",
    },
  ];
}

export function defaultAiWorkflowStepDeps(): AiWorkflowStepDeps {
  return {
    groqConfigured: isGroqConfigured(),
    geminiConfigured: isGeminiConfigured(),
    completeJson: async (system, prompt) => {
      const raw = await groqJsonCompletion(prompt, {
        system,
        kind: "agent-builder",
        temperature: 0.2,
      });
      return parseJsonText(raw);
    },
    completeVisionJson: async (system, prompt, image) => {
      if (isGeminiConfigured()) {
        try {
          return await geminiVisionJson({ system, prompt, image });
        } catch (err) {
          console.warn(
            "[runtime] Gemini vision failed, trying Groq:",
            err instanceof Error ? err.message : err
          );
        }
      }
      const raw = await groqVisionJsonCompletion({
        system,
        prompt,
        mimeType: image.mimeType,
        base64: image.base64,
        temperature: 0.3,
      });
      try {
        return parseJsonText(raw);
      } catch {
        return { summary: raw, concepts: [] };
      }
    },
    generateImages: async (image, concepts, options, extras) =>
      generateConceptImages({
        image,
        concepts,
        options,
        scene: extras.scene,
        notes: extras.notes,
      }),
  };
}

export function isAiWorkflowNode(node: { category?: string; type?: string }): boolean {
  return node.category === "ai" || Boolean(node.type?.startsWith("ai_"));
}

export function fallbackWorkflowSummary(
  agentName: string,
  reason: "missing-input" | "vision-failed" = "missing-input"
): string {
  if (reason === "vision-failed") {
    return [
      `# ${agentName} result`,
      "Wave received the uploaded photo but could not analyze it.",
      "No decoration concepts or prices were invented.",
      "Try another JPEG, PNG, or WebP and run again.",
    ].join("\n\n");
  }
  return [
    `# ${agentName} result`,
    "Wave executed the saved workflow.",
    "No photo was uploaded on this run, so no designs, decorations, or prices were generated.",
    "Upload a venue photo on the next page and run again. Wave will not invent those details.",
  ].join("\n\n");
}

export async function completeAiWorkflowStep(params: {
  task: string;
  agent: Pick<BuilderAgentRecord, "name" | "goal" | "description" | "instructions" | "safetySettings">;
  lastToolName?: string | null;
  lastToolOutput?: Record<string, unknown>;
  existingSummary?: string;
  sourceImage?: SourceImage | null;
  deps?: AiWorkflowStepDeps;
}): Promise<AiWorkflowStepResult> {
  const existing = params.existingSummary?.trim() ?? "";
  if (existing.length > 20) {
    return { summary: existing, conceptPrompts: [], conceptImages: [] };
  }

  const deps = params.deps ?? defaultAiWorkflowStepDeps();
  const image = params.sourceImage;
  const canVision = Boolean(deps.completeVisionJson) && (deps.geminiConfigured || deps.groqConfigured);
  if (image && !canVision && !deps.groqConfigured) {
    return {
      summary: fallbackWorkflowSummary(params.agent.name, "vision-failed"),
      conceptPrompts: [],
      conceptImages: [],
    };
  }
  if (!image && !deps.groqConfigured) {
    return {
      summary: fallbackWorkflowSummary(params.agent.name, "missing-input"),
      conceptPrompts: [],
      conceptImages: [],
    };
  }

  const answers = setupAnswersFromAgent(params.agent);
  const system = [
    "You are Wave executing one AI workflow step.",
    "Look at the uploaded photo. Describe only what is visible.",
    "Then propose 2 decoration concepts that restyle THIS exact place. Keep the real location.",
    "Do not invent a different venue, furniture that cannot fit, or specific prices.",
    "Return JSON only: {\"summary\":\"markdown for the operator\",\"concepts\":[{\"title\":\"short name\",\"prompt\":\"image generation prompt that keeps this photo as the scene\"}]}",
  ].join(" ");

  const prompt = JSON.stringify({
    agentName: params.agent.name,
    goal: params.agent.goal,
    description: params.agent.description,
    instructions: params.agent.instructions,
    task: params.task,
    setupAnswers: answers,
    lastToolName: params.lastToolName ?? null,
    lastToolOutput: params.lastToolOutput ?? {},
    photoFilename: image?.filename ?? null,
    photoProvided: Boolean(image),
  });

  try {
    const parsed = image
      ? deps.completeVisionJson
        ? await deps.completeVisionJson(system, prompt, image)
        : null
      : await deps.completeJson(system, prompt);
    const extracted = parseVisionPayload(parsed);
    if (extracted.summary.length >= 12) {
      const imageGen = parseImageGenOptions(answers);
      const conceptPrompts =
        extracted.conceptPrompts.length > 0
          ? extracted.conceptPrompts
          : image
            ? defaultConceptPrompts(params.task)
            : [];
      const directed = conceptPrompts.slice(0, imageGen.count).map((concept) => ({
        title: concept.title,
        prompt: buildDirectorImagePrompt({
          scene: extracted.summary,
          title: concept.title,
          notes: answers.venue_notes,
          options: imageGen,
        }),
      }));
      let conceptImages: ConceptImage[] = [];
      let generationError: string | undefined;
      let generationProvider: string | undefined;
      let generationModel: string | undefined;
      let generationErrorKind: string | undefined;
      let generationRetryable: boolean | undefined;
      if (image && directed.length && deps.generateImages) {
        const generated = await deps.generateImages(image, directed, imageGen, {
          scene: extracted.summary,
          notes: answers.venue_notes,
        });
        if (Array.isArray(generated)) {
          conceptImages = generated;
        } else {
          conceptImages = generated.images;
          generationError = generated.error;
          generationProvider = generated.provider;
          generationModel = generated.model;
          generationErrorKind = generated.errorKind;
          generationRetryable = generated.retryable;
        }
      }
      return {
        summary: extracted.summary,
        conceptPrompts: directed,
        conceptImages,
        generationError,
        generationProvider,
        generationModel,
        generationErrorKind,
        generationRetryable,
      };
    }
  } catch (err) {
    console.warn("[runtime] AI photo step failed:", err instanceof Error ? err.message : err);
  }
  return {
    summary: fallbackWorkflowSummary(params.agent.name, image ? "vision-failed" : "missing-input"),
    conceptPrompts: [],
    conceptImages: [],
  };
}
