import { loadOwnedTemplateRun } from "@/lib/templates/execution-record";
import { secureError, secureJson } from "@/lib/security/api";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ runId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return secureError("Unauthorized", 401);

  const { runId } = await context.params;
  const id = runId?.trim() ?? "";
  if (!id) return secureError("Result not found.", 404);

  try {
    const run = await loadOwnedTemplateRun(supabase, { runId: id, userId: user.id });
    if (!run) {
      return secureJson(
        { success: false, error: "You do not have access to this result." },
        { status: 404 }
      );
    }
    return secureJson({ success: true, run });
  } catch (err) {
    return secureError(err instanceof Error ? err.message : "Failed to load result.", 500);
  }
}
