import type { SupabaseClient } from "@supabase/supabase-js";
import type { DecisionAgentFinding, DecisionAgentRunRecord, DecisionRunReport } from "./run-types";

function mapFinding(value: unknown): DecisionAgentFinding | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.name !== "string") return null;
  const status = row.status;
  if (
    status !== "pending" &&
    status !== "running" &&
    status !== "completed" &&
    status !== "failed" &&
    status !== "unable_to_verify"
  ) {
    return null;
  }
  const strings = (key: string): string[] =>
    Array.isArray(row[key]) ? row[key].filter((item): item is string => typeof item === "string") : [];
  return {
    id: row.id,
    name: row.name,
    role: typeof row.role === "string" ? row.role : "",
    status,
    summary: typeof row.summary === "string" ? row.summary : "",
    evidence: strings("evidence"),
    sources: Array.isArray(row.sources)
      ? row.sources.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const source = item as Record<string, unknown>;
          if (typeof source.url !== "string") return [];
          return [
            {
              title: typeof source.title === "string" ? source.title : source.url,
              url: source.url,
              name: typeof source.name === "string" ? source.name : source.url,
              snippet: typeof source.snippet === "string" ? source.snippet : "",
              kind:
                source.kind === "official" ||
                source.kind === "exchange" ||
                source.kind === "company" ||
                source.kind === "media"
                  ? source.kind
                  : "unknown",
              publicationDate: typeof source.publicationDate === "string" ? source.publicationDate : null,
              retrievedAt: typeof source.retrievedAt === "string" ? source.retrievedAt : "",
            },
          ];
        })
      : [],
    dates: strings("dates"),
    assumptions: strings("assumptions"),
    uncertainties: strings("uncertainties"),
    verifiedFacts: strings("verifiedFacts"),
    estimates: strings("estimates"),
    unknowns: strings("unknowns"),
    risks: strings("risks"),
    counterarguments: strings("counterarguments"),
    conflicts: strings("conflicts"),
    missingInformation: strings("missingInformation"),
    error: typeof row.error === "string" ? row.error : null,
    startedAt: typeof row.startedAt === "string" ? row.startedAt : null,
    finishedAt: typeof row.finishedAt === "string" ? row.finishedAt : null,
  };
}

export function parseDecisionRunReport(value: unknown, fallbackTitle: string): DecisionRunReport {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const agents = Array.isArray(row.agents)
    ? row.agents.map(mapFinding).filter((item): item is DecisionAgentFinding => Boolean(item))
    : [];
  const overall =
    row.overall === "block" || row.overall === "insufficient" || row.overall === "review"
      ? row.overall
      : "insufficient";
  const quality =
    row.evidenceQuality === "high" ||
    row.evidenceQuality === "medium" ||
    row.evidenceQuality === "low" ||
    row.evidenceQuality === "insufficient"
      ? row.evidenceQuality
      : "insufficient";
  return {
    title: typeof row.title === "string" ? row.title : fallbackTitle,
    executedAt: typeof row.executedAt === "string" ? row.executedAt : new Date().toISOString(),
    overall,
    overallExplanation: typeof row.overallExplanation === "string" ? row.overallExplanation : "",
    evidenceQuality: quality,
    ipoStatus: typeof row.ipoStatus === "string" ? row.ipoStatus : null,
    ipoStatusVerified: row.ipoStatusVerified === true,
    financialAnalysis: typeof row.financialAnalysis === "string" ? row.financialAnalysis : null,
    nextSteps: Array.isArray(row.nextSteps)
      ? row.nextSteps.filter((item): item is string => typeof item === "string")
      : [],
    agents,
    insufficientVerifiedInformation: row.insufficientVerifiedInformation === true || overall === "insufficient",
  };
}

function mapRun(row: Record<string, unknown>): DecisionAgentRunRecord {
  const title = String(row.title ?? "Decision run");
  return {
    id: String(row.id),
    userId: String(row.user_id),
    organizationId: String(row.organization_id),
    decisionAgentId: row.decision_agent_id ? String(row.decision_agent_id) : null,
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
    title,
    purpose: String(row.purpose ?? ""),
    input: (row.input && typeof row.input === "object" ? row.input : {}) as Record<string, unknown>,
    config: (row.config && typeof row.config === "object" ? row.config : {}) as Record<string, unknown>,
    status: row.status === "completed" || row.status === "failed" ? row.status : "running",
    report: parseDecisionRunReport(row.report, title),
    error: typeof row.error === "string" ? row.error : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function isMissingRunsTable(error: { message?: string; code?: string } | null): boolean {
  const message = error?.message ?? "";
  return error?.code === "PGRST205" || /decision_agent_runs|schema cache/i.test(message);
}

export async function findRunByIdempotency(
  supabase: SupabaseClient,
  params: { userId: string; idempotencyKey: string }
): Promise<DecisionAgentRunRecord | null> {
  const { data, error } = await supabase
    .from("decision_agent_runs")
    .select("*")
    .eq("user_id", params.userId)
    .eq("idempotency_key", params.idempotencyKey)
    .maybeSingle();
  if (error) {
    if (isMissingRunsTable(error)) throw new Error("RUNS_TABLE_MISSING");
    throw new Error(error.message);
  }
  return data ? mapRun(data as Record<string, unknown>) : null;
}

export async function createDecisionAgentRun(
  supabase: SupabaseClient,
  params: {
    userId: string;
    organizationId: string;
    title: string;
    purpose: string;
    input: Record<string, unknown>;
    config: Record<string, unknown>;
    report: DecisionRunReport;
    idempotencyKey?: string;
    decisionAgentId?: string | null;
  }
): Promise<DecisionAgentRunRecord> {
  const { data, error } = await supabase
    .from("decision_agent_runs")
    .insert({
      user_id: params.userId,
      organization_id: params.organizationId,
      decision_agent_id: params.decisionAgentId ?? null,
      idempotency_key: params.idempotencyKey ?? null,
      title: params.title,
      purpose: params.purpose,
      input: params.input,
      config: params.config,
      status: "running",
      report: params.report,
    })
    .select("*")
    .single();

  if (error) {
    if (isMissingRunsTable(error)) throw new Error("RUNS_TABLE_MISSING");
    if (error.code === "23505" && params.idempotencyKey) {
      const existing = await findRunByIdempotency(supabase, {
        userId: params.userId,
        idempotencyKey: params.idempotencyKey,
      });
      if (existing) return existing;
    }
    throw new Error(error.message);
  }
  return mapRun(data as Record<string, unknown>);
}

export async function updateDecisionAgentRun(
  supabase: SupabaseClient,
  params: {
    id: string;
    userId: string;
    status?: DecisionAgentRunRecord["status"];
    report?: DecisionRunReport;
    error?: string | null;
  }
): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (params.status) patch.status = params.status;
  if (params.report) patch.report = params.report;
  if (params.error !== undefined) patch.error = params.error;
  const { error } = await supabase
    .from("decision_agent_runs")
    .update(patch)
    .eq("id", params.id)
    .eq("user_id", params.userId);
  if (error) {
    if (isMissingRunsTable(error)) throw new Error("RUNS_TABLE_MISSING");
    throw new Error(error.message);
  }
}

export async function getDecisionAgentRunForUser(
  supabase: SupabaseClient,
  params: { id: string; userId: string }
): Promise<DecisionAgentRunRecord | null> {
  const { data, error } = await supabase
    .from("decision_agent_runs")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (error) {
    if (isMissingRunsTable(error)) throw new Error("RUNS_TABLE_MISSING");
    throw new Error(error.message);
  }
  return data ? mapRun(data as Record<string, unknown>) : null;
}
