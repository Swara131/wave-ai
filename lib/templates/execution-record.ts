import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentRunRecord, AgentRunStatus, BuilderAgentRecord } from "@/lib/agents/runtime-types";
import { mapAgentRunRow, type AgentRunRow } from "@/lib/agents/runtime-mappers";
import {
  getAgentRunById,
  insertAgentRun,
  isMissingRuntimeTableError,
  updateAgentRun,
} from "@/lib/agents/runtime-repository";
import { createAgentResultNotification } from "@/lib/email/agent-result-notification";
import { getUserById } from "@/lib/email/repository";
import { getPublicGalleryTemplates, type PublicGallerySlug } from "./public-gallery";

export type TemplateExecutionStatus = "completed" | "needs_approval" | "blocked" | "failed";

export interface RecordTemplateExecutionParams {
  admin: SupabaseClient;
  agent: Pick<BuilderAgentRecord, "id" | "name" | "slug" | "userId" | "organizationId">;
  userId: string;
  templateSlug: string;
  templateName: string;
  idempotencyKey: string;
  inputSummary: string;
  resultPayload: Record<string, unknown>;
  executionStatus: TemplateExecutionStatus;
  safetyDecision?: string | null;
  approvalState?: string | null;
  errorMessage?: string | null;
  sources?: string[];
}

function runStatusFor(executionStatus: TemplateExecutionStatus): AgentRunStatus {
  if (executionStatus === "completed") return "completed";
  if (executionStatus === "needs_approval") return "awaiting_approval";
  return "failed";
}

function notificationSeverity(status: TemplateExecutionStatus): "low" | "medium" | "high" {
  if (status === "failed" || status === "blocked") return "high";
  if (status === "needs_approval") return "medium";
  return "low";
}

async function findRunByIdempotency(
  admin: SupabaseClient,
  params: { agentId: string; userId: string; idempotencyKey: string }
): Promise<AgentRunRecord | null> {
  const { data, error } = await admin
    .from("agent_runs")
    .select("*")
    .eq("agent_id", params.agentId)
    .eq("user_id", params.userId)
    .contains("metadata", { idempotencyKey: params.idempotencyKey })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingRuntimeTableError(error.message)) return null;
    throw new Error(error.message);
  }
  if (!data) return null;
  return mapAgentRunRow(data as AgentRunRow);
}

export async function recordTemplateExecution(
  params: RecordTemplateExecutionParams
): Promise<AgentRunRecord | null> {
  const startedAt = new Date().toISOString();
  const finishedAt = new Date().toISOString();
  const metadata = {
    templateSlug: params.templateSlug,
    templateName: params.templateName,
    idempotencyKey: params.idempotencyKey,
    inputSummary: params.inputSummary,
    resultPayload: params.resultPayload,
    executionStatus: params.executionStatus,
    safetyDecision: params.safetyDecision ?? null,
    approvalState: params.approvalState ?? null,
    sources: params.sources ?? [],
  };

  try {
    const existing = await findRunByIdempotency(params.admin, {
      agentId: params.agent.id,
      userId: params.userId,
      idempotencyKey: params.idempotencyKey,
    });

    const run =
      existing ??
      (await insertAgentRun(params.admin, {
        agentId: params.agent.id,
        userId: params.userId,
        organizationId: params.agent.organizationId,
        mode: "manual",
        status: runStatusFor(params.executionStatus),
        triggerSource: `template:${params.templateSlug}`,
        metadata,
      }));

    const updated = await updateAgentRun(params.admin, {
      runId: run.id,
      userId: params.userId,
      status: runStatusFor(params.executionStatus),
      summary: params.inputSummary,
      errorMessage: params.errorMessage ?? null,
      startedAt: run.startedAt ?? startedAt,
      finishedAt,
      metadata,
    });

    await notifyTemplateRun(params, updated);
    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isMissingRuntimeTableError(message)) return null;
    console.error("[template-execution] persist failed", message);
    return null;
  }
}

async function notifyTemplateRun(
  params: RecordTemplateExecutionParams,
  run: AgentRunRecord
): Promise<void> {
  const { data: existing } = await params.admin
    .from("notifications")
    .select("id")
    .eq("user_id", params.userId)
    .eq("risk_id", run.id)
    .eq("template_type", "agent_result")
    .maybeSingle();
  if (existing?.id) return;

  const user = await getUserById(params.admin, params.userId).catch(() => null);
  const statusLabel =
    params.executionStatus === "completed"
      ? "completed"
      : params.executionStatus === "needs_approval"
        ? "needs approval"
        : params.executionStatus === "blocked"
          ? "blocked"
          : "failed";

  await createAgentResultNotification(params.admin, {
    organizationId: params.agent.organizationId,
    userId: params.userId,
    agentId: params.agent.id,
    agentSlug: params.agent.slug,
    agentName: params.templateName,
    summary: `${params.templateName} ${statusLabel}. ${params.errorMessage ?? params.inputSummary}`,
    recipientName: user?.full_name || user?.email || "WAVE user",
    runId: run.id,
    runAt: run.finishedAt ?? new Date().toISOString(),
    executionStatus: params.executionStatus,
    templateName: params.templateName,
  });

  await params.admin
    .from("notifications")
    .update({
      severity: notificationSeverity(params.executionStatus),
      template_payload: {
        agentName: params.templateName,
        agentSlug: params.agent.slug,
        summary: `${params.templateName} ${statusLabel}. ${params.errorMessage ?? params.inputSummary}`,
        recipientName: user?.full_name || user?.email || "WAVE user",
        runMode: "manual",
        runAt: run.finishedAt ?? new Date().toISOString(),
        runId: run.id,
        executionStatus: params.executionStatus,
        templateName: params.templateName,
      },
    })
    .eq("user_id", params.userId)
    .eq("risk_id", run.id)
    .eq("template_type", "agent_result");
}

export function executionStatusFromSafety(
  decision: "ALLOW" | "REVIEW" | "BLOCK" | string | undefined
): TemplateExecutionStatus {
  if (decision === "BLOCK") return "blocked";
  if (decision === "REVIEW") return "needs_approval";
  return "completed";
}

export async function loadOwnedTemplateRun(
  supabase: SupabaseClient,
  params: { runId: string; userId: string }
): Promise<AgentRunRecord | null> {
  try {
    return await getAgentRunById(supabase, params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isMissingRuntimeTableError(message)) return null;
    throw error;
  }
}

export function trackGalleryTemplateRun(params: {
  admin: SupabaseClient;
  agent: Pick<BuilderAgentRecord, "id" | "name" | "slug" | "userId" | "organizationId">;
  userId: string;
  templateSlug: PublicGallerySlug;
  idempotencyKey: string;
  inputSummary: string;
  resultPayload: Record<string, unknown>;
  executionStatus: TemplateExecutionStatus;
  safetyDecision?: string | null;
  approvalState?: string | null;
  errorMessage?: string | null;
  sources?: string[];
}): void {
  const templateName =
    getPublicGalleryTemplates().find((item) => item.slug === params.templateSlug)?.name ??
    params.templateSlug;
  void recordTemplateExecution({
    ...params,
    templateName,
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[template-execution] track failed", message);
  });
}
