import {
  guestPreviewRequestSchema,
  parsePreviewSlug,
  PreviewValidationError,
  runGuestTemplatePreview,
} from "@/lib/templates/guest-preview";
import { parseJsonBody, secureError, secureJson } from "@/lib/security/api";
import { ValidationError } from "@/lib/security/errors";

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request, guestPreviewRequestSchema);
    const slug = parsePreviewSlug(body.slug);
    const result = await runGuestTemplatePreview(slug, body.intake);
    return secureJson({ success: result.status !== "failed", result });
  } catch (err) {
    if (err instanceof PreviewValidationError || err instanceof ValidationError) {
      const message = err instanceof ValidationError ? err.details[0] ?? err.message : err.message;
      return secureError(message, 400);
    }
    const message = err instanceof Error ? err.message : "Preview failed.";
    return secureError(message, 500);
  }
}
