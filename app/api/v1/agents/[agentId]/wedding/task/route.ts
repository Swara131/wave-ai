import { getBuilderAgentForUserBySlug } from "@/lib/agents/save-builder-agent-draft";
import { weddingTaskActionSchema, weddingTaskSchema } from "@/lib/wedding-planner/intake";
import { actOnWeddingTask, addWeddingTask } from "@/lib/wedding-planner/service";
import { parseJsonBody, secureError, secureJson } from "@/lib/security/api";
import { ValidationError } from "@/lib/security/errors";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

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
    const body = await parseJsonBody(request, z.union([weddingTaskSchema, weddingTaskActionSchema]));
    const event =
      "action" in body
        ? await actOnWeddingTask({
            agent,
            userId: user.id,
            eventId: body.eventId,
            taskId: body.taskId,
            action: body.action,
          })
        : await addWeddingTask({
            agent,
            userId: user.id,
            eventId: body.eventId,
            task: {
              title: body.title,
              dueDate: body.dueDate || undefined,
              startTime: body.startTime || undefined,
              endTime: body.endTime || undefined,
              vendorId: body.vendorId || null,
            },
          });
    return secureJson({ success: true, event });
  } catch (err) {
    if (err instanceof ValidationError) return secureError(err.message, 400, { details: err.details });
    return secureError(err instanceof Error ? err.message : "Task update failed.", 400);
  }
}
