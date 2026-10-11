import { getBuilderAgentForUserBySlug } from "@/lib/agents/save-builder-agent-draft";
import { readPlatformLifecycle, writePlatformLifecycle } from "@/lib/agents/platform/lifecycle-store";
import { runAgentTestSuite } from "@/lib/agents/platform/run-test-suite";
import { isAgentReadyToDeploy } from "@/lib/agents/platform/verify-agent";
import { updateBuilderAgent } from "@/lib/agents/repository";
import { RequirementsNotReadyError } from "@/lib/agents/requirements/errors";
import { parseJsonBody, secureError, secureJson } from "@/lib/security/api";
import { ValidationError } from "@/lib/security/errors";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const testSchema = z.object({
  task: z.string().trim().min(3).max(4000).optional(),
});

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return secureError("Unauthorized", 401);

  const { agentId: slug } = await context.params;
  const normalizedSlug = slug?.trim() ?? "";
  const agent = await getBuilderAgentForUserBySlug(supabase, {
    userId: user.id,
    userEmail: user.email ?? "user@local",
    slug: normalizedSlug,
  });
  if (!agent) {
    return secureJson({ success: false, error: "Agent not found." }, { status: 404 });
  }

  try {
    const body = await parseJsonBody(request, testSchema);
    const existing = readPlatformLifecycle(agent.safetySettings);
    const result = await runAgentTestSuite(supabase, {
      agent,
      userId: user.id,
      userEmail: user.email ?? "user@local",
      task: body.task,
      existingLifecycle: existing,
    });

    await updateBuilderAgent(supabase, {
      agentId: agent.id,
      userId: user.id,
      patch: {
        safetySettings: writePlatformLifecycle(agent.safetySettings, result.lifecycle),
      },
    });

    const outcome = result.outcome;
    return secureJson({
      success: Boolean(outcome?.success),
      outcome: outcome?.kind ?? "failed",
      queryStatus: outcome?.queryStatus ?? "not_run",
      recordsProcessed: outcome?.recordsProcessed ?? 0,
      analysis: result.analysis ?? null,
      lifecycle: result.lifecycle,
      runId: result.runId,
      runStatus: result.runStatus,
      runSummary: result.runSummary,
      runError: result.runError,
      crmResult: result.crmResult ?? null,
      whatsappResult: result.whatsappResult ?? null,
      readyToDeploy: isAgentReadyToDeploy(result.lifecycle),
    });
  } catch (err) {
    if (err instanceof RequirementsNotReadyError) {
      return secureJson(
        {
          success: false,
          error: err.message,
          missing: err.missing,
        },
        { status: 400 }
      );
    }
    if (err instanceof ValidationError) {
      return secureJson({ success: false, error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Test failed.";
    return secureJson({ success: false, error: message }, { status: 500 });
  }
}
