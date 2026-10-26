import { getBuilderAgentForUserBySlug } from "@/lib/agents/save-builder-agent-draft";
import { readPlatformLifecycle, writePlatformLifecycle } from "@/lib/agents/platform/lifecycle-store";
import { runAgentTestSuite } from "@/lib/agents/platform/run-test-suite";
import { isAgentReadyToDeploy } from "@/lib/agents/platform/verify-agent";
import { updateBuilderAgent } from "@/lib/agents/repository";
import { RequirementsNotReadyError } from "@/lib/agents/requirements/errors";
import {
  SOURCE_IMAGE_MAX_BYTES,
  isAllowedSourceImage,
  sourceImageFromFile,
  type SourceImage,
} from "@/lib/agents/runtime/source-image";
import { parseJsonBody, secureError, secureJson } from "@/lib/security/api";
import { ValidationError } from "@/lib/security/errors";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const testSchema = z.object({
  task: z.string().trim().min(3).max(4000).optional(),
  source_url: z.string().trim().url().max(2000).optional(),
  runInputs: z.record(z.string(), z.string().max(4000)).optional(),
});

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

async function readTestPayload(request: Request): Promise<{
  task?: string;
  runInputs: Record<string, string>;
  sourceImage?: SourceImage;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ValidationError("Invalid upload request.");
    }
    const file = form.get("photo") ?? form.get("file");
    const notes = typeof form.get("notes") === "string" ? form.get("notes")!.toString().trim() : "";
    const taskField = typeof form.get("task") === "string" ? form.get("task")!.toString().trim() : "";
    const imageStyle =
      typeof form.get("image_style") === "string" ? form.get("image_style")!.toString().trim() : "";
    const aspectRatio =
      typeof form.get("aspect_ratio") === "string" ? form.get("aspect_ratio")!.toString().trim() : "";
    const imageQuality =
      typeof form.get("image_quality") === "string" ? form.get("image_quality")!.toString().trim() : "";
    const variationCount =
      typeof form.get("variation_count") === "string"
        ? form.get("variation_count")!.toString().trim()
        : "";
    let sourceImage: SourceImage | undefined;
    if (file instanceof File && file.size > 0) {
      if (file.size > SOURCE_IMAGE_MAX_BYTES) {
        throw new ValidationError("Photo must be 4 MB or smaller.");
      }
      if (!isAllowedSourceImage(file)) {
        throw new ValidationError("Upload a JPEG, PNG, WebP, or GIF photo.");
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      sourceImage = sourceImageFromFile(file, bytes);
    }
    const runInputs: Record<string, string> = {};
    if (sourceImage) runInputs.venue_photo = sourceImage.filename;
    if (notes) runInputs.venue_notes = notes.slice(0, 4000);
    if (imageStyle) runInputs.image_style = imageStyle.slice(0, 40);
    if (aspectRatio) runInputs.aspect_ratio = aspectRatio.slice(0, 10);
    if (imageQuality) runInputs.image_quality = imageQuality.slice(0, 8);
    if (variationCount) runInputs.variation_count = variationCount.slice(0, 2);
    const task =
      taskField ||
      (sourceImage
        ? `Analyze the uploaded venue photo${notes ? `. Notes: ${notes}` : ""} and produce concepts from what is visible. Do not invent prices.`
        : undefined);
    return { task, runInputs, sourceImage };
  }

  const body = await parseJsonBody(request, testSchema);
  const runInputs = {
    ...(body.runInputs ?? {}),
    ...(body.source_url ? { source_url: body.source_url } : {}),
  };
  return { task: body.task, runInputs };
}

export async function POST(request: Request, context: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return secureError("Unauthorized", 401);

  const { agentId: slug } = await context.params;
  const normalizedSlug = slug?.trim() ?? "";
  const agent = await getBuilderAgentForUserBySlug(supabase, {
    userId: user.id,
    userEmail: user.email ?? "user@local",
    slug: normalizedSlug,
  });
  if (!agent) {
    return secureJson({ success: false, error: "Agent not found." }, { status: 404 });
  }

  try {
    const body = await readTestPayload(request);
    const existing = readPlatformLifecycle(agent.safetySettings);
    const result = await runAgentTestSuite(supabase, {
      agent,
      userId: user.id,
      userEmail: user.email ?? "user@local",
      task: body.task,
      runInputs: Object.keys(body.runInputs).length ? body.runInputs : undefined,
      existingLifecycle: existing,
      sourceImage: body.sourceImage,
    });

    await updateBuilderAgent(supabase, {
      agentId: agent.id,
      userId: user.id,
      patch: {
        safetySettings: writePlatformLifecycle(agent.safetySettings, result.lifecycle),
      },
    });

    const outcome = result.outcome;
    return secureJson({
      success: Boolean(outcome?.success),
      outcome: outcome?.kind ?? "failed",
      queryStatus: outcome?.queryStatus ?? "not_run",
      recordsProcessed: outcome?.recordsProcessed ?? 0,
      analysis: result.analysis ?? null,
      lifecycle: result.lifecycle,
      runId: result.runId,
      proposalId: result.proposalId ?? null,
      runStatus: result.runStatus,
      runSummary: result.runSummary,
      runError: result.runError,
      conceptImages: result.conceptImages ?? [],
      generationError: result.generationError ?? null,
      generationProvider: result.generationProvider ?? null,
      generationModel: result.generationModel ?? null,
      generationErrorKind: result.generationErrorKind ?? null,
      generationRetryable: result.generationRetryable ?? false,
      crmResult: result.crmResult ?? null,
      whatsappResult: result.whatsappResult ?? null,
      readyToDeploy: isAgentReadyToDeploy(result.lifecycle),
    });
  } catch (err) {
    if (err instanceof RequirementsNotReadyError) {
      return secureJson(
        {
          success: false,
          error: err.message,
          missing: err.missing,
        },
        { status: 400 }
      );
    }
    if (err instanceof ValidationError) {
      return secureJson({ success: false, error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Test failed.";
    return secureJson({ success: false, error: message }, { status: 500 });
  }
}
