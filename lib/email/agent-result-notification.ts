import type { SupabaseClient } from "@supabase/supabase-js";
import { renderEmailTemplate } from "./templates/render";
import type { NotificationRow } from "./repository";
import { DEFAULT_MAX_RETRIES } from "./env";

export async function createAgentResultNotification(
  supabase: SupabaseClient,
  params: {
    organizationId: string;
    userId: string;
    agentId: string;
    agentSlug: string;
    agentName: string;
    summary: string;
    recipientName: string;
    runId: string | null;
    runAt?: string;
    timezone?: string;
  }
): Promise<NotificationRow> {
  const runAt = params.runAt ?? new Date().toISOString();
  const rendered = renderEmailTemplate("agent_result", {
    agentName: params.agentName,
    agentSlug: params.agentSlug,
    summary: params.summary,
    recipientName: params.recipientName,
    runMode: "scheduled",
    runAt,
    timezone: params.timezone,
  });

  const { data, error } = await supabase
    .from("notifications")
    .insert({
      organization_id: params.organizationId,
      user_id: params.userId,
      risk_title: `${params.agentName} result`,
      risk_id: params.runId ?? params.agentId,
      severity: "low",
      status: "unread",
      channel: "in_app",
      delivery_status: "delivered",
      recipient: params.recipientName,
      recipient_email: null,
      subject: rendered.subject,
      preview: rendered.preview,
      template_type: "agent_result",
      template_payload: {
        agentName: params.agentName,
        agentSlug: params.agentSlug,
        summary: params.summary,
        recipientName: params.recipientName,
        runMode: "scheduled",
        runAt,
        timezone: params.timezone,
      },
      sent_at: new Date().toISOString(),
      retry_count: 0,
      max_retries: DEFAULT_MAX_RETRIES,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create in-app notification.");
  }

  return data as NotificationRow;
}
