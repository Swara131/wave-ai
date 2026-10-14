"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { NotificationItem } from "@/lib/notification-types";
import { emitWaveNotificationsUpdated } from "@/lib/notifications/wave-live";

const POLL_MS = 4000;
const TOAST_MS = 8000;

async function loadNotifications(): Promise<NotificationItem[]> {
  const response = await fetch("/api/notifications");
  if (!response.ok) return [];
  const payload = (await response.json()) as { notifications?: NotificationItem[] };
  return payload.notifications ?? [];
}

export default function WaveNotificationHost() {
  const [toast, setToast] = useState<NotificationItem | null>(null);
  const knownIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const items = await loadNotifications();
      if (cancelled) return;
      const unread = items.filter((item) => item.status === "unread");
      const latestInApp =
        unread.find((item) => item.channel === "in_app") ??
        unread[0] ??
        null;
      emitWaveNotificationsUpdated({
        unreadCount: unread.length,
        latestInApp,
      });

      const ids = new Set(items.map((item) => item.id));
      if (!knownIds.current) {
        knownIds.current = ids;
        return;
      }
      const fresh = items.find(
        (item) =>
          item.channel === "in_app" &&
          item.status === "unread" &&
          !knownIds.current?.has(item.id)
      );
      knownIds.current = ids;
      if (fresh) {
        setToast(fresh);
        window.setTimeout(() => {
          setToast((current) => (current?.id === fresh.id ? null : current));
        }, TOAST_MS);
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  if (!toast) return null;

  return (
    <div className="wave-notify-host" role="status" aria-live="polite">
      <div className="wave-notify-toast">
        <p className="wave-notify-kicker">Wave notification</p>
        <p className="wave-notify-title">{toast.subject || toast.risk}</p>
        {toast.preview ? <p className="wave-notify-preview">{toast.preview}</p> : null}
        <Link href="/notifications" className="wave-notify-link">
          Open notifications
        </Link>
      </div>
    </div>
  );
}
