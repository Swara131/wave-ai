"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import {
  WAVE_NOTIFICATIONS_EVENT,
  type WaveNotificationsDetail,
} from "@/lib/notifications/wave-live";

export default function WaveNotificationBell() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<WaveNotificationsDetail>).detail;
      if (typeof detail?.unreadCount === "number") {
        setUnread(detail.unreadCount);
      }
    };
    window.addEventListener(WAVE_NOTIFICATIONS_EVENT, onUpdate);
    return () => window.removeEventListener(WAVE_NOTIFICATIONS_EVENT, onUpdate);
  }, []);

  return (
    <Link
      href="/notifications"
      className="ztop-bell"
      aria-label={unread > 0 ? `${unread} unread Wave notifications` : "Wave notifications"}
    >
      <Bell className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      {unread > 0 ? <span className="ztop-bell-count">{unread > 9 ? "9+" : unread}</span> : null}
    </Link>
  );
}
