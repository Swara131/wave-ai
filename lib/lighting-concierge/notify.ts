import type { SupabaseClient } from "@supabase/supabase-js";
import { executionStatusFromSafety, recordTemplateExecution } from "@/lib/templates/execution-record";
import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";
import type { LightingJob } from "./types";
import { buildVisitRequestOutput } from "./workflow";

export function lightingVisitSummary(job: LightingJob): string {
  const lines = job.appointment.outputLines?.length
    ? job.appointment.outputLines
    : [
        `Electrician visit request ${job.appointment.requestId ?? job.id} is pending confirmation.`,
        `Customer: ${job.intake.customerName}.`,
        `Address: ${job.appointment.verifiedAddress ?? job.intake.serviceAddress}.`,
        `Estimate: ₹${job.quote.totalInr.toLocaleString("en-IN")}.`,
      ];
  return lines.join("\n");
}

export async function notifyLightingVisitRequest(
  admin: SupabaseClient,
  params: { agent: Pick<BuilderAgentRecord, "id" | "name" | "slug" | "userId" | "organizationId">; job: LightingJob }
): Promise<LightingJob> {
  if (params.job.appointment.status !== "pending_confirmation") return params.job;
  if (params.job.appointment.notificationId) return params.job;

  try {
    const run = await recordTemplateExecution({
      admin,
      agent: params.agent,
      userId: params.job.userId,
      templateSlug: "lighting-concierge",
      templateName: "Lighting Concierge",
      idempotencyKey: `lighting:visit:${params.job.idempotencyKey}`,
      inputSummary: lightingVisitSummary(params.job),
      resultPayload: {
        jobId: params.job.id,
        appointment: params.job.appointment.status,
        quote: params.job.quote,
        plan: params.job.plan,
      },
      executionStatus: executionStatusFromSafety(params.job.safety.decision),
      safetyDecision: params.job.safety.decision,
      approvalState: params.job.safety.approvalStatus,
      sources: [params.job.qloo.source === "qloo" ? "qloo" : "stated_preferences"],
    });
    const notificationId = run
      ? (
          await admin
            .from("notifications")
            .select("id")
            .eq("user_id", params.job.userId)
            .eq("risk_id", run.id)
            .eq("template_type", "agent_result")
            .maybeSingle()
        ).data?.id ?? null
      : null;
    if (!notificationId) return params.job;
    const notification = { id: notificationId };
    const appointment = {
      ...params.job.appointment,
      ...buildVisitRequestOutput({
        job: params.job,
        requestedAt: params.job.appointment.requestedAt ?? new Date().toISOString(),
        proposalId: params.job.appointment.proposalId,
        notificationId: notification.id,
        preferredAt: params.job.appointment.preferredAt,
      }),
      notificationId: notification.id,
    };
    return { ...params.job, appointment, updatedAt: new Date().toISOString() };
  } catch (error) {
    console.error("[lighting] visit notification failed", error);
    return params.job;
  }
}
