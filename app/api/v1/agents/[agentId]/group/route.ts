import { getBuilderAgentForUserBySlug } from "@/lib/agents/save-builder-agent-draft";
import { groupIntakeSchema, normalizeGroupIntake } from "@/lib/group-planner/intake";
import { loadGroupWorkspace, saveGroupOuting } from "@/lib/group-planner/service";
import { parseJsonBody, secureError, secureJson } from "@/lib/security/api";
import { ValidationError } from "@/lib/security/errors";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

const bodySchema = groupIntakeSchema.and(
  z.object({
    outingId: z.string().uuid().optional(),
    saveDraft: z.boolean().optional(),
  })
);

async function loadOwnedAgent(slug: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: secureError("Unauthorized", 401) };
  const agent = await getBuilderAgentForUserBySlug(supabase, {
    userId: user.id,
    userEmail: user.email ?? "user@local",
    slug: slug.trim(),
  });
  if (!agent) {
    return { ok: false as const, error: secureJson({ error: "Agent not found." }, { status: 404 }) };
  }
  return { ok: true as const, supabase, user, agent };
}

export async function GET(_request: Request, context: RouteContext) {
  const { agentId } = await context.params;
  const loaded = await loadOwnedAgent(agentId ?? "");
  if (!loaded.ok) return loaded.error;
  try {
    const workspace = await loadGroupWorkspace(loaded.supabase, {
      userId: loaded.user.id,
      agent: loaded.agent,
    });
    return secureJson({
      success: true,
      agentName: loaded.agent.name,
      status: loaded.agent.status,
      reservationThresholdInr: workspace.reservationThresholdInr,
      outing: workspace.outing,
    });
  } catch (err) {
    return secureError(err instanceof Error ? err.message : "Failed to load Group Decision Planner.", 500);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { agentId } = await context.params;
  const loaded = await loadOwnedAgent(agentId ?? "");
  if (!loaded.ok) return loaded.error;
  try {
    const body = await parseJsonBody(request, bodySchema);
    const intake = normalizeGroupIntake(
      { ...body, isDraft: body.saveDraft === true },
      undefined
    );
    const outing = await saveGroupOuting({
      agent: loaded.agent,
      userId: loaded.user.id,
      intake,
      outingId: body.outingId,
    });
    return secureJson({ success: true, outing });
  } catch (err) {
    if (err instanceof ValidationError) {
      return secureError(err.details[0] ?? err.message, 400, { details: err.details });
    }
    return secureError(err instanceof Error ? err.message : "Failed to save the group.", 500);
  }
}
