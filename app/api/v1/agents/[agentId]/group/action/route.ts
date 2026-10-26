import { getBuilderAgentForUserBySlug } from "@/lib/agents/save-builder-agent-draft";
import { groupActionSchema } from "@/lib/group-planner/intake";
import {
  discoverGroupRestaurants,
  requestGroupReservation,
  saveGroupSettings,
  selectGroupRestaurant,
  submitGroupFeedback,
  undoGroupFeedback,
} from "@/lib/group-planner/service";
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
    const body = await parseJsonBody(request, groupActionSchema);
    if (body.action === "discover") {
      const outing = await discoverGroupRestaurants({ agent, userId: user.id, outingId: body.outingId });
      return secureJson({ success: true, outing });
    }
    if (body.action === "feedback") {
      const outing = await submitGroupFeedback({
        agent,
        userId: user.id,
        outingId: body.outingId,
        participantId: body.participantId,
        restaurantId: body.restaurantId,
        reason: body.reason,
        note: body.note,
      });
      return secureJson({ success: true, outing });
    }
    if (body.action === "undo") {
      const outing = await undoGroupFeedback({
        agent,
        userId: user.id,
        outingId: body.outingId,
        feedbackId: body.feedbackId,
      });
      return secureJson({ success: true, outing });
    }
    if (body.action === "select") {
      const outing = await selectGroupRestaurant({
        agent,
        userId: user.id,
        outingId: body.outingId,
        restaurantId: body.restaurantId,
      });
      return secureJson({ success: true, outing });
    }
    if (body.action === "reserve") {
      const outing = await requestGroupReservation({ agent, userId: user.id, outingId: body.outingId });
      return secureJson({ success: true, outing });
    }
    const reservationThresholdInr = await saveGroupSettings({
      agent,
      reservationThresholdInr: body.reservationThresholdInr,
    });
    return secureJson({ success: true, reservationThresholdInr });
  } catch (err) {
    if (err instanceof ValidationError) return secureError(err.message, 400, { details: err.details });
    return secureError(err instanceof Error ? err.message : "Group planner action failed.", 400);
  }
}
