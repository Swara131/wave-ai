import { after } from "next/server";
import { z } from "zod";
import { parseDecisionAgentConfig } from "@/lib/decision-agents/parse-config";
import { executeDecisionRun } from "@/lib/decision-agents/execute-run";
import { executionAgentsFromConfig } from "@/lib/decision-agents/execution-agents";
import { shouldReuseExistingRun } from "@/lib/decision-agents/run-id";
import {
  createDecisionAgentRun,
  findRunByIdempotency,
  updateDecisionAgentRun,
} from "@/lib/decision-agents/run-repository";
import type { DecisionAgentConfig } from "@/lib/decision-agents/types";
import type { DecisionRunReport } from "@/lib/decision-agents/run-types";
import { ensureOrganization } from "@/lib/organizations/ensure-organization";
import { parseJsonBody, secureError, secureJson } from "@/lib/security/api";
import { ValidationError } from "@/lib/security/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, type SupabaseServerClient } from "@/lib/supabase/server";

const createRunSchema = z.object({
  title: z.string().trim().min(3).max(120),
  purpose: z.string().trim().min(3).max(4000),
  config: z.record(z.string(), z.unknown()),
  input: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().uuid(),
  decisionAgentId: z.string().uuid().optional().nullable(),
});

function placeholderReport(title: string, purpose: string, config: ReturnType<typeof parseDecisionAgentConfig>, input: Record<string, unknown>): DecisionRunReport {
  const agents = executionAgentsFromConfig(config!, purpose, input).map((spec) => ({
    id: spec.id,
    name: spec.name,
    role: spec.role,
    status: "pending" as const,
    summary: "",
    evidence: [],
    sources: [],
    dates: [],
    assumptions: [],
    uncertainties: [],
    verifiedFacts: [],
    estimates: [],
    unknowns: [],
    risks: [],
    counterarguments: [],
    conflicts: [],
    missingInformation: [],
    error: null,
    startedAt: null,
    finishedAt: null,
  }));
  return {
    title,
    executedAt: new Date().toISOString(),
    overall: "insufficient",
    overallExplanation: "Run started. Findings appear as each agent finishes.",
    evidenceQuality: "insufficient",
    ipoStatus: null,
    ipoStatusVerified: false,
    financialAnalysis: null,
    nextSteps: [],
    agents,
    insufficientVerifiedInformation: true,
  };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return secureError("Unauthorized", 401);

  try {
    const body = await parseJsonBody(request, createRunSchema);
    const config = parseDecisionAgentConfig(body.config);
    if (!config) throw new ValidationError("Decision agent config is incomplete.");

    const required = (config.inputFields ?? [])
      .filter((field) => field.required)
      .filter((field) => {
        const value = body.input[field.key];
        return value === undefined || value === null || String(value).trim() === "";
      });
    if (required.length) {
      throw new ValidationError(
        `Enter real values for: ${required.map((field) => field.label).join(", ")}.`
      );
    }

    const existing = await findRunByIdempotency(supabase, {
      userId: user.id,
      idempotencyKey: body.idempotencyKey,
    });
    if (existing && shouldReuseExistingRun(existing.status)) {
      return secureJson({ success: true, runId: existing.id, status: existing.status, duplicate: true });
    }

    const organizationId = await ensureOrganization(supabase, user.id, user.email ?? "user@local");
    const report = placeholderReport(body.title, body.purpose, config, body.input);
    let runId: string;
    if (existing?.status === "failed") {
      await updateDecisionAgentRun(supabase, {
        id: existing.id,
        userId: user.id,
        status: "running",
        report,
        error: null,
      });
      runId = existing.id;
    } else {
      const run = await createDecisionAgentRun(supabase, {
        userId: user.id,
        organizationId,
        title: body.title,
        purpose: body.purpose,
        input: body.input,
        config: body.config,
        report,
        idempotencyKey: body.idempotencyKey,
        decisionAgentId: body.decisionAgentId ?? null,
      });
      runId = run.id;
    }

    scheduleDecisionRun({
      runId,
      userId: user.id,
      title: body.title,
      purpose: body.purpose,
      config,
      input: body.input,
      report,
      fallback: supabase,
    });

    return secureJson({ success: true, runId, status: "running" }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return secureJson({ success: false, error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Could not start run.";
    if (message === "RUNS_TABLE_MISSING") {
      return secureJson(
        {
          success: false,
          error:
            "decision_agent_runs is missing. Apply supabase/migrations/20261023180000_decision_agent_runs.sql, then retry.",
        },
        { status: 500 }
      );
    }
    return secureJson({ success: false, error: message }, { status: 500 });
  }
}

function persistClient(fallback: SupabaseServerClient) {
  try {
    return createAdminClient();
  } catch {
    return fallback;
  }
}

function scheduleDecisionRun(params: {
  runId: string;
  userId: string;
  title: string;
  purpose: string;
  config: DecisionAgentConfig;
  input: Record<string, unknown>;
  report: DecisionRunReport;
  fallback: SupabaseServerClient;
}) {
  after(async () => {
    const db = persistClient(params.fallback);
    try {
      const finished = await executeDecisionRun({
        title: params.title,
        purpose: params.purpose,
        config: params.config,
        input: params.input,
        onProgress: async (findings) => {
          await updateDecisionAgentRun(db, {
            id: params.runId,
            userId: params.userId,
            status: "running",
            report: {
              ...params.report,
              agents: findings,
              executedAt: new Date().toISOString(),
            },
          });
        },
      });
      await updateDecisionAgentRun(db, {
        id: params.runId,
        userId: params.userId,
        status: "completed",
        report: finished,
        error: null,
      });
    } catch (err) {
      await updateDecisionAgentRun(db, {
        id: params.runId,
        userId: params.userId,
        status: "failed",
        error: err instanceof Error ? err.message : "Run failed.",
      });
    }
  });
}
