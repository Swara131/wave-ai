"use client";

import { useState } from "react";
import {
  Mail,
  MessageSquare,
  Users,
  Clock,
  User,
  RefreshCw,
  Eye,
  CheckCheck,
} from "lucide-react";
import SeverityBadge from "@/components/risk/SeverityBadge";
import type { NotificationItem } from "@/lib/notification-types";
import {
  CHANNEL_CONFIG,
  DELIVERY_CONFIG,
  STATUS_CONFIG,
} from "@/lib/dummy-notifications";

interface NotificationCardProps {
  notification: NotificationItem;
  index: number;
  onRetry: (id: string) => void;
  onPreview: (notification: NotificationItem) => void;
  onMarkRead: (id: string) => void;
}

const CHANNEL_ICONS = {
  email: Mail,
  whatsapp: MessageSquare,
  slack: MessageSquare,
  teams: Users,
  in_app: Users,
};

export default function NotificationCard({
  notification,
  index,
  onRetry,
  onPreview,
  onMarkRead,
}: NotificationCardProps) {
  const [retrying, setRetrying] = useState(false);
  const channel = CHANNEL_CONFIG[notification.channel];
  const delivery = DELIVERY_CONFIG[notification.deliveryStatus];
  const status = STATUS_CONFIG[notification.status];
  const ChannelIcon = CHANNEL_ICONS[notification.channel];

  const canRetry =
    notification.deliveryStatus === "failed" ||
    notification.deliveryStatus === "bounced";

  const handleRetry = async () => {
    setRetrying(true);
    await new Promise((r) => setTimeout(r, 800));
    onRetry(notification.id);
    setRetrying(false);
  };

  return (
    <article
      className={`notification-card glass-strong overflow-hidden rounded-2xl ring-1 transition-all duration-300 ${
        notification.status === "unread"
          ? "ring-indigo-400/20 notification-card-unread"
          : "ring-white/8"
      }`}
      style={{ animationDelay: `${index * 80}ms` }}
      onClick={() => onPreview(notification)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPreview(notification);
        }
      }}
      role="button"
      tabIndex={0}
    >
      {/* Severity accent */}
      <div
        className="h-0.5"
        style={{
          background:
            notification.severity === "critical"
              ? "linear-gradient(90deg, #ff4769, #ff8c00)"
              : notification.severity === "high"
                ? "#ff8c00"
                : notification.severity === "medium"
                  ? "#ffb900"
                  : "#00bcf2",
        }}
      />

      <div className="p-5 sm:p-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={notification.severity} size="sm" />
              <span
                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={{
                  background: `${channel.color}15`,
                  color: channel.color,
                  border: `1px solid ${channel.color}30`,
                }}
              >
                <ChannelIcon className="h-3 w-3" strokeWidth={2} />
                {channel.label}
              </span>
              <span
                className="rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={{
                  background: `${status.color}15`,
                  color: status.color,
                }}
              >
                {status.label}
              </span>
            </div>

            <h3 className="mt-3 text-base font-semibold text-[var(--ds-text-primary)] sm:text-lg">
              {notification.risk}
            </h3>
            <p className="mt-1 line-clamp-2 text-sm text-[var(--ds-text-secondary)]">{notification.subject}</p>
          </div>

          {notification.status === "unread" && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onMarkRead(notification.id);
              }}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/8 hover:text-zinc-200"
            >
              <CheckCheck className="h-3.5 w-3.5" strokeWidth={2} />
              Mark read
            </button>
          )}
        </div>

        {/* Meta grid */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="notification-meta-cell rounded-xl bg-white/2 px-3 py-2.5 ring-1 ring-white/5">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              <Clock className="h-3 w-3" strokeWidth={2} />
              Timestamp
            </div>
            <p className="mt-1 font-mono text-xs text-[var(--ds-text-primary)]" suppressHydrationWarning>
              {new Date(notification.timestamp).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>

          <div className="notification-meta-cell rounded-xl bg-white/2 px-3 py-2.5 ring-1 ring-white/5">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              <User className="h-3 w-3" strokeWidth={2} />
              Recipient
            </div>
            <p className="mt-1 truncate text-xs text-zinc-300">{notification.recipient}</p>
            {notification.recipientEmail && (
              <p className="truncate text-[11px] text-zinc-600">{notification.recipientEmail}</p>
            )}
          </div>

          <div className="notification-meta-cell rounded-xl bg-white/2 px-3 py-2.5 ring-1 ring-white/5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              Delivery Status
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  background: delivery.color,
                  boxShadow:
                    notification.deliveryStatus === "pending" ||
                    notification.deliveryStatus === "retrying"
                      ? `0 0 6px ${delivery.color}`
                      : undefined,
                  animation:
                    notification.deliveryStatus === "pending" ||
                    notification.deliveryStatus === "retrying"
                      ? "gentle-pulse 2s ease-in-out infinite"
                      : undefined,
                }}
              />
              <span className="text-xs font-semibold" style={{ color: delivery.color }}>
                {delivery.label}
              </span>
              {notification.retryCount > 0 && (
                <span className="font-mono text-[10px] text-zinc-600">
                  ({notification.retryCount}/{notification.maxRetries})
                </span>
              )}
            </div>
          </div>

          <div className="notification-meta-cell rounded-xl bg-white/2 px-3 py-2.5 ring-1 ring-white/5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              Risk ID
            </div>
            <p className="mt-1 font-mono text-xs text-zinc-400">{notification.riskId}</p>
          </div>
        </div>

        {/* Actions */}
        <div
          className="mt-5 flex flex-wrap gap-2 border-t border-white/6 pt-4"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => onPreview(notification)}
            className="notification-btn notification-btn-preview inline-flex items-center gap-2"
          >
            <Eye className="h-4 w-4" strokeWidth={2} />
            {notification.openHref?.startsWith("/runs/")
              ? "Open Result"
              : notification.channel === "in_app" || notification.templateType === "agent_result"
                ? "Open"
                : "Preview"}
          </button>

          {canRetry && notification.retryCount < notification.maxRetries && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void handleRetry();
              }}
              disabled={retrying}
              className="notification-btn notification-btn-retry inline-flex items-center gap-2"
            >
              {retrying ? (
                <span className="approval-btn-spinner" />
              ) : (
                <RefreshCw className="h-4 w-4" strokeWidth={2} />
              )}
              Retry
            </button>
          )}

          {notification.retryCount >= notification.maxRetries &&
            notification.deliveryStatus === "bounced" && (
              <span className="inline-flex items-center px-3 py-2 text-xs text-red-400/80">
                Max retries reached
              </span>
            )}
        </div>
      </div>
    </article>
  );
}
