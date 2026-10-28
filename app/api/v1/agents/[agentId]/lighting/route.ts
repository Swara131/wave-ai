import { getBuilderAgentForUserBySlug } from "@/lib/agents/save-builder-agent-draft";
import {
  lightingIntakeSchema,
  normalizeLightingIntake,
} from "@/lib/lighting-concierge/intake";
import { generateLightingPlan, loadLightingWorkspace } from "@/lib/lighting-concierge/service";
import { parseJsonBody, secureError, secureJson } from "@/lib/security/api";
import { ValidationError } from "@/lib/security/errors";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

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
    const workspace = await loadLightingWorkspace(loaded.supabase, {
      userId: loaded.user.id,
      agent: loaded.agent,
    });
    return secureJson({
      success: true,
      agentName: loaded.agent.name,
      status: loaded.agent.status,
      rates: workspace.rates,
      job: workspace.job,
    });
  } catch (err) {
    return secureError(err instanceof Error ? err.message : "Failed to load Lighting Concierge.", 500);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { agentId } = await context.params;
  const loaded = await loadOwnedAgent(agentId ?? "");
  if (!loaded.ok) return loaded.error;

  try {
    const body = await parseJsonBody(request, lightingIntakeSchema);
    const job = await generateLightingPlan({
      supabase: loaded.supabase,
      agent: loaded.agent,
      userId: loaded.user.id,
      intake: normalizeLightingIntake(body),
    });
    return secureJson({ success: true, job });
  } catch (err) {
    if (err instanceof ValidationError) {
      const message = err.details[0] ?? err.message;
      return secureError(message, 400, { details: err.details });
    }
    return secureError(err instanceof Error ? err.message : "Failed to generate lighting plan.", 500);
  }
}
