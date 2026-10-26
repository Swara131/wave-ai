"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, CheckCheck } from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import NotificationTabs from "./NotificationTabs";
import NotificationCard from "./NotificationCard";
import EmailPreviewModal from "./EmailPreviewModal";
import type { NotificationItem, NotificationTab } from "@/lib/notification-types";

async function fetchNotifications(): Promise<NotificationItem[]> {
  const response = await fetch("/api/notifications");
  const payload = (await response.json()) as {
    notifications?: NotificationItem[];
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to load notifications.");
  }

  return payload.notifications ?? [];
}

export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<NotificationTab>("unread");
  const [preview, setPreview] = useState<NotificationItem | null>(null);

  useEffect(() => {
    let cancelled = false;

    void fetchNotifications()
      .then((items) => {
        if (!cancelled) setNotifications(items);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : "Failed to load notifications."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(
    () => ({
      unread: notifications.filter((n) => n.status === "unread").length,
      all: notifications.length,
      in_app: notifications.filter((n) => n.channel === "in_app").length,
      email: notifications.filter((n) => n.channel === "email").length,
      whatsapp: notifications.filter((n) => n.channel === "whatsapp").length,
      slack: notifications.filter((n) => n.channel === "slack").length,
      teams: notifications.filter((n) => n.channel === "teams").length,
    }),
    [notifications]
  );

  const filtered = useMemo(() => {
    switch (activeTab) {
      case "unread":
        return notifications.filter((n) => n.status === "unread");
      case "in_app":
        return notifications.filter((n) => n.channel === "in_app");
      case "email":
        return notifications.filter((n) => n.channel === "email");
      case "whatsapp":
        return notifications.filter((n) => n.channel === "whatsapp");
      case "slack":
        return notifications.filter((n) => n.channel === "slack");
      case "teams":
        return notifications.filter((n) => n.channel === "teams");
      default:
        return notifications;
    }
  }, [notifications, activeTab]);

  const handleRetry = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id
          ? {
              ...n,
              deliveryStatus: "retrying" as const,
              retryCount: n.retryCount + 1,
            }
          : n
      )
    );

    try {
      const response = await fetch(`/api/notifications/${id}/retry`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

      setNotifications((prev) =>
        prev.map((n) =>
          n.id === id
            ? {
                ...n,
                deliveryStatus: response.ok && payload.success ? "delivered" : "failed",
              }
            : n
        )
      );
    } catch {
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, deliveryStatus: "failed" as const } : n
        )
      );
    }
  }, []);

  const handleMarkRead = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, status: "read" as const } : n))
    );

    try {
      await fetch(`/api/notifications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "read" }),
      });
    } catch {
      /* optimistic UI already updated */
    }
  }, []);

  const handleMarkAllRead = async () => {
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, status: "read" as const }))
    );

    try {
      await fetch("/api/notifications", { method: "PATCH" });
    } catch {
      /* optimistic UI already updated */
    }
  };

  return (
    <PageShell maxWidth="4xl">
      <PageHeader
        icon={Bell}
        title="Alerts"
        description="Notifications when an agent action needs your attention — by email, Slack, or Teams."
        badge={
          counts.unread > 0 ? (
            <span className="ds-badge ds-badge-brand">{counts.unread} unread</span>
          ) : undefined
        }
        actions={
          counts.unread > 0 ? (
            <Button variant="secondary" icon={CheckCheck} onClick={handleMarkAllRead}>
              Mark all read
            </Button>
          ) : undefined
        }
      />

      <div className="ds-section fade-in-up" style={{ animationDelay: "0.05s" }}>
        <NotificationTabs active={activeTab} onChange={setActiveTab} counts={counts} />
      </div>

      {loadError && (
        <p className="mb-4 text-sm text-red-400" role="alert">
          {loadError}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-[var(--ds-text-secondary)]">Loading notifications…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title="No notifications"
          description={
            activeTab === "unread"
              ? "You're all caught up — no unread notifications."
              : `No notifications in ${activeTab}.`
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((notification, index) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              index={index}
              onRetry={handleRetry}
              onPreview={(item) => {
                if (item.status === "unread") {
                  void handleMarkRead(item.id);
                }
                if (item.openHref) {
                  router.push(item.openHref);
                  return;
                }
                setPreview(item);
              }}
              onMarkRead={handleMarkRead}
            />
          ))}
        </div>
      )}

      <EmailPreviewModal notification={preview} onClose={() => setPreview(null)} />
    </PageShell>
  );
}
