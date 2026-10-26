import { isValidDecisionRunId } from "@/lib/decision-agents/run-id";
import { getDecisionAgentRunForUser } from "@/lib/decision-agents/run-repository";
import { secureError, secureJson } from "@/lib/security/api";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return secureError("Unauthorized", 401);

  const { runId } = await context.params;
  if (!isValidDecisionRunId(runId)) {
    return secureJson({ success: false, error: "Run not found." }, { status: 404 });
  }

  try {
    const run = await getDecisionAgentRunForUser(supabase, { id: runId, userId: user.id });
    if (!run) {
      return secureJson({ success: false, error: "Run not found." }, { status: 404 });
    }
    return secureJson({ success: true, run });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load run.";
    if (message === "RUNS_TABLE_MISSING") {
      return secureJson(
        {
          success: false,
          error:
            "decision_agent_runs is missing. Apply supabase/migrations/20261023180000_decision_agent_runs.sql.",
        },
        { status: 500 }
      );
    }
    return secureJson({ success: false, error: message }, { status: 500 });
  }
}
