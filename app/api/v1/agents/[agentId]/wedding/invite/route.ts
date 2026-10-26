import { getBuilderAgentForUserBySlug } from "@/lib/agents/save-builder-agent-draft";
import { weddingInviteSchema } from "@/lib/wedding-planner/intake";
import { saveWeddingInvitation } from "@/lib/wedding-planner/service";
import { parseJsonBody, secureError, secureJson } from "@/lib/security/api";
import { ValidationError } from "@/lib/security/errors";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
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
    const body = await parseJsonBody(request, weddingInviteSchema);
    const event = await saveWeddingInvitation({
      agent,
      userId: user.id,
      eventId: body.eventId,
      tone: body.tone,
      hostNames: body.hostNames,
      venueName: body.venueName,
      eventTime: body.eventTime,
      extraWording: body.extraWording,
    });
    return secureJson({ success: true, event });
  } catch (err) {
    if (err instanceof ValidationError) return secureError(err.message, 400, { details: err.details });
    return secureError(err instanceof Error ? err.message : "Invitation draft failed.", 400);
  }
}
