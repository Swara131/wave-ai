"use client";

import Link from "next/link";
import Modal from "@/components/ui/Modal";
import type { NotificationItem } from "@/lib/notification-types";
import SeverityBadge from "@/components/risk/SeverityBadge";
import { CHANNEL_CONFIG } from "@/lib/dummy-notifications";

interface EmailPreviewModalProps {
  notification: NotificationItem | null;
  onClose: () => void;
}

export default function EmailPreviewModal({ notification, onClose }: EmailPreviewModalProps) {
  const channel = notification ? CHANNEL_CONFIG[notification.channel] : null;

  return (
    <Modal
      open={Boolean(notification)}
      onClose={onClose}
      title={notification?.subject || "Notification"}
      variant="center"
      size="lg"
      footer={
        notification?.openHref ? (
          <Link href={notification.openHref} className="ds-btn ds-btn-primary">
            Open result
          </Link>
        ) : null
      }
    >
      {notification ? (
        <div className="notif-preview-body">
          <p className="notif-preview-meta">
            {channel?.label ?? notification.channel} · {notification.recipient}
            {notification.recipientEmail ? ` · ${notification.recipientEmail}` : ""}
            {" · "}
            {new Date(notification.timestamp).toLocaleString("en-IN")}
          </p>
          <div className="notif-preview-risk">
            <SeverityBadge severity={notification.severity} size="sm" />
            <span>{notification.risk}</span>
          </div>
          <pre className="notif-preview-text">{notification.preview || "No details were stored for this notification."}</pre>
        </div>
      ) : null}
    </Modal>
  );
}
