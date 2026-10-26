import { getBuilderAgentForUserBySlug } from "@/lib/agents/save-builder-agent-draft";
import { sourceImageFromDataUrl } from "@/lib/agents/runtime/source-image";
import { generateGeminiImage } from "@/lib/images/gemini-image";
import { GeminiImageError, imageGenerationUserMessage } from "@/lib/images/errors";
import { buildDirectorImagePrompt } from "@/lib/images/director-prompt";
import {
  parseAspectRatio,
  parseImageQuality,
  parseImageStyle,
} from "@/lib/images/types";
import { parseJsonBody, secureError, secureJson } from "@/lib/security/api";
import { ValidationError } from "@/lib/security/errors";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const generateSchema = z.object({
  photoDataUrl: z.string().min(32).max(8_000_000).optional(),
  photoName: z.string().max(180).optional(),
  prompt: z.string().trim().min(8).max(4000),
  title: z.string().trim().max(80).optional(),
  style: z.string().trim().max(40).optional(),
  aspectRatio: z.string().trim().max(10).optional(),
  quality: z.string().trim().max(8).optional(),
  variation: z.boolean().optional(),
});

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

const inflight = new Map<string, number>();

export async function POST(request: Request, context: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return secureError("Unauthorized", 401);

  const { agentId: slug } = await context.params;
  const agent = await getBuilderAgentForUserBySlug(supabase, {
    userId: user.id,
    userEmail: user.email ?? "user@local",
    slug: slug?.trim() ?? "",
  });
  if (!agent) {
    return secureJson({ success: false, error: "Agent not found." }, { status: 404 });
  }

  const lockKey = `${user.id}:${agent.id}`;
  const started = inflight.get(lockKey);
  if (started && Date.now() - started < 45_000) {
    return secureJson(
      {
        success: false,
        error: "Image generation is already running. Wait for it to finish.",
        errorKind: "duplicate",
        retryable: false,
      },
      { status: 409 }
    );
  }
  inflight.set(lockKey, Date.now());

  try {
    const body = await parseJsonBody(request, generateSchema);
    const options = {
      style: parseImageStyle(body.style),
      aspectRatio: parseAspectRatio(body.aspectRatio),
      quality: parseImageQuality(body.quality),
      count: 1 as const,
      variation: Boolean(body.variation),
    };
    const prompt = body.variation
      ? buildDirectorImagePrompt({
          scene: body.prompt,
          title: body.title,
          options,
        })
      : body.prompt;
    const image = body.photoDataUrl
      ? sourceImageFromDataUrl(body.photoDataUrl, body.photoName)
      : undefined;
    const generated = await generateGeminiImage({
      prompt,
      title: body.title || "Generated image",
      image,
      options,
    });
    return secureJson({
      success: true,
      image: {
        title: body.title || "Generated image",
        dataUrl: generated.dataUrl,
        prompt: generated.prompt,
        provider: "gemini",
        model: generated.model,
        aspectRatio: options.aspectRatio,
        quality: options.quality,
      },
      provider: "gemini",
      model: generated.model,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return secureJson({ success: false, error: err.message, errorKind: "validation", retryable: false }, { status: 400 });
    }
    const classified = err instanceof GeminiImageError ? err : null;
    return secureJson(
      {
        success: false,
        error: imageGenerationUserMessage(err),
        errorKind: classified?.kind ?? "provider",
        retryable: classified?.retryable ?? false,
        model: classified?.model ?? null,
      },
      { status: 502 }
    );
  } finally {
    inflight.delete(lockKey);
  }
}
