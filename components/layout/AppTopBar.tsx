"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import AccountMenu from "@/components/layout/AccountMenu";
import WaveNotificationBell from "@/components/notifications/WaveNotificationBell";
import { getPageTitle } from "@/lib/navigation/page-titles";

interface AppTopBarProps {
  onOpenMobileNav?: () => void;
  /** Hide title + actions for full-bleed workspace pages that provide their own header row. */
  minimal?: boolean;
}

export default function AppTopBar({ onOpenMobileNav, minimal = false }: AppTopBarProps) {
  const pathname = usePathname();
  const title = getPageTitle(pathname);

  if (minimal) {
    return (
      <header className="ztop ztop-minimal">
        <button
          type="button"
          className="ztop-menu-btn lg:hidden"
          aria-label="Open navigation"
          onClick={onOpenMobileNav}
        >
          <Menu className="h-5 w-5" strokeWidth={2} />
        </button>
        <div className="ztop-minimal-spacer" aria-hidden="true" />
        <div className="ztop-actions">
          <WaveNotificationBell />
          <Link href="/billing" className="ds-btn ds-btn-secondary ztop-upgrade">
            Upgrade
          </Link>
          <AccountMenu />
        </div>
      </header>
    );
  }

  return (
    <header className="ztop">
      <div className="ztop-left">
        <button
          type="button"
          className="ztop-menu-btn lg:hidden"
          aria-label="Open navigation"
          onClick={onOpenMobileNav}
        >
          <Menu className="h-5 w-5" strokeWidth={2} />
        </button>
        <div className="ztop-crumb">
          <span className="ztop-crumb-root">Wave</span>
          <span className="ztop-crumb-sep" aria-hidden="true">
            /
          </span>
          <h1 className="ztop-title">{title}</h1>
        </div>
      </div>
      <div className="ztop-actions">
        <WaveNotificationBell />
        <Link href="/billing" className="ds-btn ds-btn-secondary ztop-upgrade">
          Upgrade
        </Link>
        <AccountMenu />
      </div>
    </header>
  );
}
