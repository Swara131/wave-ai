import type { ConceptImage, ConceptPrompt } from "@/lib/agents/runtime/concept-image";
import type { SourceImage } from "@/lib/agents/runtime/source-image";
import {
  getGeminiApiKey,
  getGeminiImageModel,
  isGeminiConfigured,
  isGeminiImageModel,
} from "@/lib/gemini/env";
import { buildDirectorImagePrompt } from "./director-prompt";
import {
  classifyGeminiImageError,
  GeminiImageError,
  imageGenerationUserMessage,
  logGeminiImageFailure,
  type GeminiErrorPayload,
} from "./errors";
import { DEFAULT_IMAGE_GEN, type ImageGenOptions } from "./types";

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
}

export interface GeneratedImageBatch {
  images: ConceptImage[];
  error?: string;
  errorKind?: string;
  retryable?: boolean;
  provider?: string;
  model?: string;
}

export type GeminiFetch = (
  input: string,
  init: RequestInit
) => Promise<Response>;

const MAX_RATE_LIMIT_RETRIES = 2;

function dataUrlFromPart(part: GeminiPart): string | null {
  const mime =
    part.inlineData?.mimeType?.trim() ||
    part.inline_data?.mime_type?.trim() ||
    "image/png";
  const data = part.inlineData?.data?.trim() || part.inline_data?.data?.trim() || "";
  if (!data) return null;
  return `data:${mime};base64,${data}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs && retryAfterMs > 0) return retryAfterMs;
  const base = 400 * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(8_000, base + jitter);
}

async function requestGeminiImage(params: {
  model: string;
  apiKey: string;
  prompt: string;
  image?: SourceImage;
  aspectRatio: string;
  quality: string;
  includeImageSize: boolean;
  fetchImpl: GeminiFetch;
}): Promise<string> {
  const parts: Array<Record<string, unknown>> = [{ text: params.prompt }];
  if (params.image) {
    parts.push({
      inlineData: {
        mimeType: params.image.mimeType,
        data: params.image.base64,
      },
    });
  }

  const imageConfig: Record<string, string> = { aspectRatio: params.aspectRatio };
  if (params.includeImageSize) imageConfig.imageSize = params.quality;

  const response = await params.fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": params.apiKey,
      },
      signal: AbortSignal.timeout(55_000),
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.4,
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig,
        },
      }),
    }
  );

  const payload = (await response.json()) as GeminiErrorPayload & {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  };
  if (!response.ok) {
    throw classifyGeminiImageError({
      httpStatus: response.status,
      payload,
      retryAfter: response.headers.get("retry-after"),
      model: params.model,
    });
  }
  const responseParts = payload.candidates?.[0]?.content?.parts ?? [];
  for (const part of responseParts) {
    const url = dataUrlFromPart(part);
    if (url) return url;
  }
  throw new GeminiImageError({
    kind: "provider",
    message: "Gemini returned no image. WAVE will not invent a substitute image.",
    httpStatus: response.status,
    retryable: false,
    model: params.model,
  });
}

export async function generateGeminiImage(params: {
  prompt: string;
  title: string;
  image?: SourceImage;
  options?: Partial<ImageGenOptions>;
  fetchImpl?: GeminiFetch;
  nowConfigured?: boolean;
}): Promise<{ dataUrl: string; model: string; prompt: string }> {
  if (!(params.nowConfigured ?? isGeminiConfigured())) {
    throw new GeminiImageError({
      kind: "missing_config",
      message:
        "Add GEMINI_API_KEY to .env.local to generate images with Gemini. WAVE does not invent image URLs.",
      retryable: false,
    });
  }

  const options = { ...DEFAULT_IMAGE_GEN, ...params.options };
  const model = getGeminiImageModel();
  if (!isGeminiImageModel(model)) {
    throw new GeminiImageError({
      kind: "unsupported_model",
      message: `GEMINI_IMAGE_MODEL=${model} is not an image-generation model. Set it to gemini-3.1-flash-image.`,
      retryable: false,
      model,
    });
  }

  const apiKey = getGeminiApiKey();
  const fetchImpl = params.fetchImpl ?? fetch;
  let includeImageSize = true;
  let rateLimitAttempts = 0;

  while (true) {
    try {
      const dataUrl = await requestGeminiImage({
        model,
        apiKey,
        prompt: params.prompt,
        image: params.image,
        aspectRatio: options.aspectRatio,
        quality: options.quality,
        includeImageSize,
        fetchImpl,
      });
      return { dataUrl, model, prompt: params.prompt };
    } catch (err) {
      const classified =
        err instanceof GeminiImageError
          ? err
          : classifyGeminiImageError({
              httpStatus: 0,
              rawMessage: err instanceof Error ? err.message : String(err),
              model,
            });
      if (includeImageSize && /imagesize|image_size/i.test(classified.message)) {
        includeImageSize = false;
        continue;
      }
      if (classified.retryable && classified.kind === "rate_limit" && rateLimitAttempts < MAX_RATE_LIMIT_RETRIES) {
        await sleep(backoffMs(rateLimitAttempts, classified.retryAfterMs));
        rateLimitAttempts += 1;
        continue;
      }
      logGeminiImageFailure(classified);
      throw classified;
    }
  }
}

export async function generateGeminiConceptImages(params: {
  image: SourceImage;
  concepts: ConceptPrompt[];
  options?: ImageGenOptions;
  scene?: string;
  notes?: string;
}): Promise<GeneratedImageBatch> {
  if (!isGeminiConfigured()) {
    return {
      images: [],
      provider: "gemini",
      errorKind: "missing_config",
      retryable: false,
      error:
        "Add GEMINI_API_KEY to .env.local to generate high-quality concept photos with Gemini Flash Image. WAVE does not invent image URLs.",
    };
  }
  if (params.concepts.length === 0) {
    return { images: [], provider: "gemini", error: "No image prompt was produced from the photo." };
  }

  const options = { ...DEFAULT_IMAGE_GEN, ...params.options };
  const count = Math.min(options.count, 2, params.concepts.length);
  const images: ConceptImage[] = [];
  let modelUsed: string | undefined;
  let lastError: string | undefined;
  let errorKind: string | undefined;
  let retryable = false;

  for (const concept of params.concepts.slice(0, count)) {
    const prompt = buildDirectorImagePrompt({
      scene: params.scene || concept.prompt,
      title: concept.title,
      notes: params.notes,
      options,
    });
    try {
      const generated = await generateGeminiImage({
        prompt,
        title: concept.title,
        image: params.image,
        options,
      });
      modelUsed = generated.model;
      images.push({
        title: concept.title,
        dataUrl: generated.dataUrl,
        prompt: generated.prompt,
        provider: "gemini",
        model: generated.model,
        aspectRatio: options.aspectRatio,
        quality: options.quality,
      });
    } catch (err) {
      lastError = imageGenerationUserMessage(err);
      if (err instanceof GeminiImageError) {
        errorKind = err.kind;
        retryable = err.retryable;
      }
      break;
    }
  }

  if (images.length === 0) {
    return {
      images: [],
      provider: "gemini",
      model: modelUsed,
      error: lastError || "Gemini did not return an image.",
      errorKind,
      retryable,
    };
  }

  return {
    images,
    provider: "gemini",
    model: modelUsed,
    error: lastError,
    errorKind,
    retryable,
  };
}
