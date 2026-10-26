import { getBuilderAgentForUserBySlug } from "@/lib/agents/save-builder-agent-draft";
import { lightingRatesSchema } from "@/lib/lighting-concierge/intake";
import { saveLightingRates } from "@/lib/lighting-concierge/service";
import { parseJsonBody, secureError, secureJson } from "@/lib/security/api";
import { ValidationError } from "@/lib/security/errors";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return secureError("Unauthorized", 401);

  const { agentId } = await context.params;
  const agent = await getBuilderAgentForUserBySlug(supabase, {
    userId: user.id,
    userEmail: user.email ?? "user@local",
    slug: agentId?.trim() ?? "",
  });
  if (!agent) return secureJson({ error: "Agent not found." }, { status: 404 });

  try {
    const body = await parseJsonBody(request, lightingRatesSchema);
    const rates = await saveLightingRates({
      supabase,
      agent,
      userId: user.id,
      rates: body,
    });
    return secureJson({ success: true, rates });
  } catch (err) {
    if (err instanceof ValidationError) {
      return secureError(err.message, 400, { details: err.details });
    }
    return secureError(err instanceof Error ? err.message : "Could not save rates.", 400);
  }
}
