import { getBuilderAgentForUserBySlug } from "@/lib/agents/save-builder-agent-draft";
import { travelBookingSchema } from "@/lib/travel-companion/intake";
import { requestTravelBooking } from "@/lib/travel-companion/service";
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
    const body = await parseJsonBody(request, travelBookingSchema);
    const trip = await requestTravelBooking({
      agent,
      userId: user.id,
      tripId: body.tripId,
      activityId: body.activityId,
      partySize: body.partySize,
    });
    return secureJson({ success: true, trip });
  } catch (err) {
    if (err instanceof ValidationError) {
      return secureError(err.message, 400, { details: err.details });
    }
    return secureError(err instanceof Error ? err.message : "Booking request failed.", 400);
  }
}
