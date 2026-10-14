import type { NotificationItem } from "@/lib/notification-types";

export const WAVE_NOTIFICATIONS_EVENT = "wave:notifications-updated";

export interface WaveNotificationsDetail {
  unreadCount: number;
  latestInApp: NotificationItem | null;
}

export function emitWaveNotificationsUpdated(detail: WaveNotificationsDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WAVE_NOTIFICATIONS_EVENT, { detail }));
}
