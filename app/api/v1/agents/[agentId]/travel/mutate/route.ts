import { getBuilderAgentForUserBySlug } from "@/lib/agents/save-builder-agent-draft";
import { travelMutateSchema } from "@/lib/travel-companion/intake";
import { mutateTravelTrip } from "@/lib/travel-companion/service";
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
    const body = await parseJsonBody(request, travelMutateSchema);
    const trip = await mutateTravelTrip({
      agent,
      userId: user.id,
      tripId: body.tripId,
      action: body.action,
      activityId: body.activityId,
      dayIndex: body.dayIndex,
    });
    return secureJson({ success: true, trip });
  } catch (err) {
    if (err instanceof ValidationError) {
      return secureError(err.message, 400, { details: err.details });
    }
    return secureError(err instanceof Error ? err.message : "Could not update the itinerary.", 400);
  }
}
