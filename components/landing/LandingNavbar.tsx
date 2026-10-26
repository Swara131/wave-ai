"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, Shield, X } from "lucide-react";
import { COMPANY_NAME } from "@/lib/public-branding";

const LINKS = [
  { href: "#product", label: "Product" },
  { href: "#templates", label: "Templates" },
  { href: "#safety", label: "Safety" },
  { href: "#pricing", label: "Pricing" },
];

export default function LandingNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`landing-nav ${scrolled ? "is-scrolled" : ""}`}>
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label={`${COMPANY_NAME} home`}>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--primary)] text-white">
            <Shield className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
            {COMPANY_NAME}
          </span>
        </Link>

        <nav className="hidden items-center gap-7 lg:flex" aria-label="Primary">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            href="/login"
            className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Sign in
          </Link>
          <Link href="/signup" className="landing-cta-primary rounded-full px-5 py-2.5 text-sm font-semibold">
            Build your agent
          </Link>
        </div>

        <button
          type="button"
          className="rounded-lg p-2 text-[var(--text-secondary)] md:hidden"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <AnimatePresence>
        {mobileOpen ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-4 md:hidden"
          >
            <div className="flex flex-col gap-3">
              {LINKS.map((link) => (
                <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)}>
                  {link.label}
                </Link>
              ))}
              <Link href="/login" onClick={() => setMobileOpen(false)}>
                Sign in
              </Link>
              <Link href="/signup" className="landing-cta-primary rounded-full px-4 py-2 text-center text-sm font-semibold">
                Build your agent
              </Link>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
