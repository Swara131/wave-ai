"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import LandingNavbar from "@/components/landing/LandingNavbar";
import LandingFooter from "@/components/landing/LandingFooter";
import {
  getPublicGalleryTemplates,
  type PublicGallerySlug,
} from "@/lib/templates/public-gallery";
import type { GuestPreviewResult } from "@/lib/templates/guest-preview";

const STORAGE_PREFIX = "wave-preview:";

function loadDraft(slug: string): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + slug);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function saveDraft(slug: string, intake: Record<string, unknown>): void {
  sessionStorage.setItem(STORAGE_PREFIX + slug, JSON.stringify(intake));
}

function lightingDefaults(): Record<string, unknown> {
  return {
    customerName: "Aisha",
    roomType: "living_room",
    roomPurpose: "Evening family time and reading",
    preferredStyle: "modern",
    lightingPreference: "warm",
    budgetInr: 18000,
    serviceAddress: "Bandra West, Mumbai",
    jobKind: "consultation",
  };
}

function travelDefaults(): Record<string, unknown> {
  return {
    destination: "Jaipur",
    startDate: "2026-11-14",
    endDate: "2026-11-16",
    travelers: 2,
    budgetAmount: 18000,
    budgetCurrency: "INR",
    interests: ["food", "history", "art"],
    pace: "balanced",
  };
}

function weddingDefaults(): Record<string, unknown> {
  return {
    eventName: "Mehra garden wedding",
    eventType: "wedding",
    startDate: "2026-12-12",
    location: "Jaipur",
    guestCount: 180,
    budgetAmount: 850000,
    budgetCurrency: "INR",
    couplePreferences: "Garden venue, vegetarian thali, indie live music",
    venueStyle: "garden",
  };
}

function groupDefaults(): Record<string, unknown> {
  return {
    groupName: "Saturday dinner",
    city: "Mumbai",
    outingDate: "2026-11-08",
    startTime: "19:00",
    maxBudgetInr: 8000,
    budgetCurrency: "INR",
    maxTravelMinutes: 40,
    participants: [
      {
        displayName: "Aisha",
        likes: ["A.R. Rahman", "vegetarian thali", "indie films"],
        neighborhood: "Bandra",
      },
      {
        displayName: "Rohan",
        likes: ["seafood", "jazz", "walking tours"],
        neighborhood: "Colaba",
      },
    ],
  };
}

export default function TemplateGuestPreviewPage({ slug }: { slug: PublicGallerySlug }) {
  const template = useMemo(
    () => getPublicGalleryTemplates().find((item) => item.slug === slug)!,
    [slug]
  );
  const [intake, setIntake] = useState<Record<string, unknown>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GuestPreviewResult | null>(null);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const draft = loadDraft(slug);
    setIntake(
      draft ??
        (slug === "lighting-concierge"
          ? lightingDefaults()
          : slug === "travel-companion"
            ? travelDefaults()
            : slug === "wedding-celebration-planner"
              ? weddingDefaults()
              : groupDefaults())
    );
    void fetch("/api/notifications")
      .then((response) => setAuthed(response.ok))
      .catch(() => setAuthed(false));
  }, [slug]);

  const update = (key: string, value: unknown) => {
    setIntake((current) => {
      const next = { ...current, [key]: value };
      saveDraft(slug, next);
      return next;
    });
  };

  const runPreview = useCallback(async () => {
    setRunning(true);
    setError(null);
    saveDraft(slug, intake);
    try {
      const response = await fetch("/api/v1/templates/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, intake }),
      });
      const payload = (await response.json()) as { result?: GuestPreviewResult; error?: string };
      if (!response.ok || !payload.result) {
        throw new Error(payload.error ?? "Preview failed.");
      }
      setResult(payload.result);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Preview failed.");
    } finally {
      setRunning(false);
    }
  }, [intake, slug]);

  const loginHref = `/login?redirectTo=${encodeURIComponent(`/preview/${slug}`)}`;

  return (
    <div className="landing-page min-h-screen">
      <LandingNavbar />
      <main id="main-content" className="mx-auto max-w-3xl px-4 pb-16 pt-28 sm:px-6">
        <p className="landing-kicker">Guest preview</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{template.name}</h1>
        <p className="mt-3 text-[var(--text-secondary)]">{template.shortDescription}</p>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          This preview does not save private history, send bookings, take payments, or send invitations.
        </p>

        <form
          className="landing-card mt-8 space-y-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void runPreview();
          }}
        >
          {slug === "lighting-concierge" ? (
            <>
              <Field label="Customer name" value={String(intake.customerName ?? "")} onChange={(v) => update("customerName", v)} />
              <Field label="Room purpose" value={String(intake.roomPurpose ?? "")} onChange={(v) => update("roomPurpose", v)} />
              <Field label="Service address" value={String(intake.serviceAddress ?? "")} onChange={(v) => update("serviceAddress", v)} />
              <Field label="Budget (INR)" value={String(intake.budgetInr ?? "")} onChange={(v) => update("budgetInr", Number(v) || 0)} />
            </>
          ) : null}
          {slug === "travel-companion" ? (
            <>
              <Field label="Destination" value={String(intake.destination ?? "")} onChange={(v) => update("destination", v)} />
              <Field label="Start date" value={String(intake.startDate ?? "")} onChange={(v) => update("startDate", v)} />
              <Field label="End date" value={String(intake.endDate ?? "")} onChange={(v) => update("endDate", v)} />
              <Field label="Budget (INR)" value={String(intake.budgetAmount ?? "")} onChange={(v) => update("budgetAmount", Number(v) || 0)} />
            </>
          ) : null}
          {slug === "wedding-celebration-planner" ? (
            <>
              <Field label="Event name" value={String(intake.eventName ?? "")} onChange={(v) => update("eventName", v)} />
              <Field label="Location" value={String(intake.location ?? "")} onChange={(v) => update("location", v)} />
              <Field label="Event date" value={String(intake.startDate ?? "")} onChange={(v) => update("startDate", v)} />
              <Field label="Couple / organizer preferences" value={String(intake.couplePreferences ?? "")} onChange={(v) => update("couplePreferences", v)} />
            </>
          ) : null}
          {slug === "group-decision-planner" ? (
            <>
              <Field label="Group name" value={String(intake.groupName ?? "")} onChange={(v) => update("groupName", v)} />
              <Field label="City" value={String(intake.city ?? "")} onChange={(v) => update("city", v)} />
              <Field label="Date" value={String(intake.outingDate ?? "")} onChange={(v) => update("outingDate", v)} />
              <p className="text-xs text-[var(--text-secondary)]">
                Sample includes two friends with separate likes. Sign in to save Not-for-me feedback.
              </p>
            </>
          ) : null}

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className="landing-cta-primary rounded-full px-5 py-2.5 text-sm font-semibold disabled:opacity-60"
              disabled={running}
            >
              {running ? "Generating preview…" : "Run preview"}
            </button>
            {authed ? (
              <Link
                href={`/agents/templates`}
                className="landing-cta-secondary rounded-full px-5 py-2.5 text-sm font-semibold"
              >
                Save with my account
              </Link>
            ) : (
              <Link href={loginHref} className="landing-cta-secondary rounded-full px-5 py-2.5 text-sm font-semibold">
                Sign in to save
              </Link>
            )}
          </div>
        </form>

        {result ? (
          <section className="landing-card mt-6 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">
              {result.status === "failed" ? "Preview incomplete" : "Preview result (not saved)"}
            </p>
            <p className="mt-2 font-medium">{result.summary}</p>
            <ul className="mt-3 space-y-1 text-sm text-[var(--text-secondary)]">
              {result.warnings.map((warning) => (
                <li key={warning}>• {warning}</li>
              ))}
            </ul>
            <pre className="mt-4 max-h-[420px] overflow-auto rounded-xl bg-[var(--surface-muted)] p-4 text-xs">
              {JSON.stringify(result.result, null, 2)}
            </pre>
          </section>
        ) : null}
      </main>
      <LandingFooter />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <input
        className="ds-input mt-1 w-full"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
