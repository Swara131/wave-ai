import type { RiskSeverity } from "./risk-types";

export type NotificationChannel = "email" | "whatsapp" | "slack" | "teams" | "in_app";
export type NotificationStatus = "unread" | "read" | "archived";
export type DeliveryStatus = "delivered" | "pending" | "failed" | "bounced" | "retrying";

export interface NotificationItem {
  id: string;
  risk: string;
  riskId: string;
  timestamp: string;
  severity: RiskSeverity;
  status: NotificationStatus;
  recipient: string;
  recipientEmail?: string;
  channel: NotificationChannel;
  deliveryStatus: DeliveryStatus;
  subject: string;
  preview: string;
  retryCount: number;
  maxRetries: number;
  templateType?: string | null;
  openHref?: string | null;
}

export type NotificationTab = "unread" | "all" | "in_app" | "email" | "whatsapp" | "slack" | "teams";
