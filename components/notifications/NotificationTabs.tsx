"use client";

import type { LucideIcon } from "lucide-react";
import { Bell, Mail, MessageCircle, MessageSquare, Users } from "lucide-react";
import type { NotificationTab } from "@/lib/notification-types";

interface NotificationTabsProps {
  active: NotificationTab;
  onChange: (tab: NotificationTab) => void;
  counts: Record<NotificationTab, number>;
}

const TABS: { key: NotificationTab; label: string; icon?: LucideIcon }[] = [
  { key: "unread", label: "Unread" },
  { key: "all", label: "All" },
  { key: "in_app", label: "Wave", icon: Bell },
  { key: "email", label: "Email", icon: Mail },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { key: "slack", label: "Slack", icon: MessageSquare },
  { key: "teams", label: "Teams", icon: Users },
];

export default function NotificationTabs({ active, onChange, counts }: NotificationTabsProps) {
  return (
    <div className="ds-tabs" role="tablist" aria-label="Notification filters">
      {TABS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={active === key}
          onClick={() => onChange(key)}
          className={`ds-tab inline-flex items-center gap-2 ${active === key ? "ds-tab-active" : ""}`}
        >
          {Icon && <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
          {label}
          {counts[key] > 0 && (
            <span className="ds-badge-count">{counts[key]}</span>
          )}
        </button>
      ))}
    </div>
  );
}
