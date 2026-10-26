import type {
  NotificationChannel,
  NotificationItem,
} from "@/lib/notification-types";
import type { NotificationRow } from "./repository";

function mapDeliveryStatus(
  status: string
): NotificationItem["deliveryStatus"] {
  if (
    status === "delivered" ||
    status === "pending" ||
    status === "failed" ||
    status === "bounced" ||
    status === "retrying"
  ) {
    return status;
  }
  return "pending";
}

function mapReadStatus(status: string): NotificationItem["status"] {
  if (status === "read" || status === "archived") return status;
  return "unread";
}

function mapChannel(channel: string): NotificationChannel {
  if (
    channel === "whatsapp" ||
    channel === "slack" ||
    channel === "teams" ||
    channel === "in_app"
  ) {
    return channel;
  }
  return "email";
}

export function notificationOpenHref(row: {
  template_type: string | null;
  template_payload: unknown;
  approval_request_id: string | null;
}): string | null {
  const payload =
    row.template_payload && typeof row.template_payload === "object"
      ? (row.template_payload as Record<string, unknown>)
      : {};
  const slug = typeof payload.agentSlug === "string" ? payload.agentSlug.trim() : "";
  const agentId = typeof payload.agentId === "string" ? payload.agentId.trim() : "";
  if (row.template_type === "agent_result") {
    const runId = typeof payload.runId === "string" ? payload.runId.trim() : "";
    if (runId) return `/runs/${encodeURIComponent(runId)}`;
    const id = slug || agentId;
    if (id) return `/agents/${encodeURIComponent(id)}/result`;
  }
  if (row.approval_request_id) {
    return `/approvals`;
  }
  if (row.template_type === "gateway_review_requested") {
    return "/approvals";
  }
  return null;
}

function payloadSummary(row: NotificationRow): string {
  const payload =
    row.template_payload && typeof row.template_payload === "object"
      ? (row.template_payload as Record<string, unknown>)
      : {};
  if (typeof payload.summary === "string" && payload.summary.trim()) {
    return payload.summary.trim();
  }
  return row.preview;
}

export function mapNotificationRow(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    risk: row.risk_title,
    riskId: row.risk_id ?? row.id,
    timestamp: row.sent_at ?? row.created_at,
    severity: row.severity,
    status: mapReadStatus(row.status),
    recipient: row.recipient,
    recipientEmail: row.recipient_email ?? undefined,
    channel: mapChannel(row.channel),
    deliveryStatus: mapDeliveryStatus(row.delivery_status),
    subject: row.subject,
    preview: payloadSummary(row),
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    templateType: row.template_type,
    openHref: notificationOpenHref(row),
  };
}
