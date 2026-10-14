"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen, Shield, X } from "lucide-react";
import AppTopBar from "@/components/layout/AppTopBar";
import WaveNotificationHost from "@/components/notifications/WaveNotificationHost";
import { COMPANY_NAME } from "@/lib/public-branding";
import {
  isSidebarNavActive,
  SIDEBAR_PRIMARY_NAV,
  SIDEBAR_SECONDARY_NAV,
} from "@/lib/navigation/sidebar-nav";

function isWorkspaceRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/agents/create") ||
    pathname.includes("/workflow") ||
    (pathname.startsWith("/agents/") && pathname.endsWith("/edit"))
  );
}

export default function ZeltaAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const hideChrome =
    pathname.startsWith("/onboarding/welcome") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/auth/");

  if (hideChrome) {
    return <>{children}</>;
  }

  const workspaceRoute = isWorkspaceRoute(pathname);

  return (
    <div className={`zshell ${collapsed ? "zshell-collapsed" : ""}`}>
      <aside
        className={`zshell-sidebar ${mobileOpen ? "zshell-sidebar-open" : ""} ${collapsed ? "is-collapsed" : ""}`}
        aria-label="Primary navigation"
      >
        <div className="zshell-brand">
          <Link
            href="/dashboard"
            className="zshell-brand-link"
            onClick={() => setMobileOpen(false)}
            suppressHydrationWarning
          >
            <span className="zshell-brand-mark" aria-hidden="true">
              <Shield className="h-4 w-4" strokeWidth={2.25} />
            </span>
            <span className="zshell-brand-text">{COMPANY_NAME}</span>
          </Link>
          <button
            type="button"
            className="zshell-close lg:hidden"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="zshell-nav" aria-label="Main">
          {SIDEBAR_PRIMARY_NAV.map(({ href, label, icon: Icon, matchPrefix }) => {
            const active = isSidebarNavActive(pathname, href, matchPrefix ?? true);
            return (
              <Link
                key={href}
                href={href}
                className={`zshell-nav-link ${active ? "zshell-nav-link-active" : ""}`}
                aria-current={active ? "page" : undefined}
                title={collapsed ? label : undefined}
                onClick={() => setMobileOpen(false)}
              >
                <Icon className="zshell-nav-icon" strokeWidth={2} aria-hidden="true" />
                <span className="zshell-nav-label">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="zshell-nav-spacer" aria-hidden="true" />

        <nav className="zshell-nav zshell-nav-bottom" aria-label="Account">
          {SIDEBAR_SECONDARY_NAV.map(({ href, label, icon: Icon }) => {
            const active = isSidebarNavActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={`zshell-nav-link ${active ? "zshell-nav-link-active" : ""}`}
                aria-current={active ? "page" : undefined}
                title={collapsed ? label : undefined}
                onClick={() => setMobileOpen(false)}
              >
                <Icon className="zshell-nav-icon" strokeWidth={2} aria-hidden="true" />
                <span className="zshell-nav-label">{label}</span>
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          className="zshell-collapse-btn hidden lg:inline-flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" strokeWidth={2} />
          ) : (
            <PanelLeftClose className="h-4 w-4" strokeWidth={2} />
          )}
        </button>
      </aside>

      {mobileOpen ? (
        <button
          type="button"
          className="zshell-backdrop lg:hidden"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <div className="zshell-main">
        <AppTopBar
          minimal={workspaceRoute}
          onOpenMobileNav={() => setMobileOpen(true)}
        />
        <main className={`zshell-content ${workspaceRoute ? "zshell-content-workspace" : ""}`}>
          {children}
        </main>
      </div>
      <WaveNotificationHost />
    </div>
  );
}
