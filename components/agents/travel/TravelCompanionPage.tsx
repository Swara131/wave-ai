"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2, Shield } from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import ErrorState from "@/components/ui/ErrorState";
import StatusBadge from "@/components/ui/StatusBadge";
import {
  INTERESTS,
  PACES,
  SAMPLE_TRAVEL_INTAKE,
  TRANSPORTS,
} from "@/lib/travel-companion/constants";
import { travelIntakeFieldErrors, travelIntakeSchema } from "@/lib/travel-companion/intake";
import type { TravelActivity, TravelIntake, TravelTrip } from "@/lib/travel-companion/types";

const INTEREST_LABELS: Record<(typeof INTERESTS)[number], string> = {
  food: "Food",
  music: "Music",
  art: "Art",
  museums: "Museums",
  nature: "Nature",
  shopping: "Shopping",
  nightlife: "Nightlife",
  history: "History",
  adventure: "Adventure",
  family: "Family",
};

function Field({
  label,
  hint,
  error,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`lc-field${wide ? " lc-field-wide" : ""}${error ? " lc-field-invalid" : ""}`}>
      <span className="lc-label">{label}</span>
      {hint ? <span className="lc-hint">{hint}</span> : null}
      {children}
      {error ? <span className="lc-field-error">{error}</span> : null}
    </label>
  );
}

function Banner({
  tone,
  title,
  children,
}: {
  tone: "ok" | "warn" | "block" | "error";
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={`lc-banner lc-banner-${tone}`} role="status">
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

function money(amount: number | null, currency: string): string {
  if (amount == null) return "Unknown";
  if (currency === "INR") return `₹${amount.toLocaleString("en-IN")}`;
  return `${amount.toLocaleString()} ${currency}`;
}

function bookingLabel(status: string): string {
  if (status === "pending_confirmation") return "Pending confirmation";
  if (status === "awaiting_approval") return "Awaiting approval";
  if (status === "blocked") return "Blocked";
  if (status === "rejected") return "Rejected";
  return status;
}

export default function TravelCompanionPage() {
  const params = useParams();
  const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
  const [agentName, setAgentName] = useState("Travel Companion for Local Discovery");
  const [agentStatus, setAgentStatus] = useState("draft");
  const [threshold, setThreshold] = useState(5000);
  const [thresholdDraft, setThresholdDraft] = useState("5000");
  const [trip, setTrip] = useState<TravelTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "block"; title: string; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [dayIndex, setDayIndex] = useState(0);
  const [bookingActivity, setBookingActivity] = useState<TravelActivity | null>(null);
  const [confirmBooking, setConfirmBooking] = useState(false);
  const [intake, setIntake] = useState<Partial<TravelIntake>>({
    destination: "",
    travelers: 2,
    budgetAmount: 18000,
    budgetCurrency: "INR",
    interests: ["food", "history"],
    pace: "balanced",
  });

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/travel`);
      const payload = (await response.json()) as {
        agentName?: string;
        status?: string;
        bookingThresholdInr?: number;
        trip?: TravelTrip | null;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Could not load Travel Companion.");
      setAgentName(payload.agentName ?? "Travel Companion for Local Discovery");
      setAgentStatus(payload.status ?? "draft");
      setThreshold(payload.bookingThresholdInr ?? 5000);
      setThresholdDraft(String(payload.bookingThresholdInr ?? 5000));
      setTrip(payload.trip ?? null);
      if (payload.trip?.intake) {
        setIntake((current) => ({ ...current, ...payload.trip?.intake }));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Travel Companion.");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedDay = trip?.itinerary.days[dayIndex] ?? trip?.itinerary.days[0] ?? null;

  const plan = async (replan = false) => {
    setGenerating(true);
    setError(null);
    setNotice(null);
    setFieldErrors({});
    try {
      const parsed = travelIntakeSchema.safeParse({
        ...intake,
        replanTripId: replan ? trip?.id : undefined,
        interests: intake.interests ?? [],
      });
      if (!parsed.success) {
        setFieldErrors(travelIntakeFieldErrors(parsed.error));
        throw new Error(parsed.error.issues[0]?.message ?? "Check the intake form and try again.");
      }
      const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/travel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(45_000),
      });
      const payload = (await response.json()) as { trip?: TravelTrip; error?: string };
      if (!response.ok || !payload.trip) throw new Error(payload.error ?? "Could not plan the trip.");
      setTrip(payload.trip);
      setDayIndex(0);
      const qlooFallback = payload.trip.qloo.source !== "qloo";
      setNotice({
        tone: qlooFallback ? "warn" : "ok",
        title: qlooFallback ? "Personalization used fallback data" : "Itinerary saved",
        text: qlooFallback
          ? payload.trip.qloo.error ?? "Qloo was unavailable, so WAVE used the traveler's stated preferences."
          : "Day-by-day plan stored. Venues, hours, and prices remain unverified until a places provider is connected.",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not plan the trip.");
    } finally {
      setGenerating(false);
    }
  };

  const mutate = async (action: "remove" | "replace" | "regenerate_day", activityId?: string) => {
    if (!trip) return;
    setWorking(action);
    setError(null);
    try {
      const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/travel/mutate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId: trip.id,
          action,
          activityId,
          dayIndex,
        }),
      });
      const payload = (await response.json()) as { trip?: TravelTrip; error?: string };
      if (!response.ok || !payload.trip) throw new Error(payload.error ?? "Could not update the itinerary.");
      setTrip(payload.trip);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the itinerary.");
    } finally {
      setWorking(null);
    }
  };

  const requestBooking = async () => {
    if (!trip || !bookingActivity || !confirmBooking) return;
    setWorking("booking");
    setError(null);
    try {
      const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/travel/booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId: trip.id,
          activityId: bookingActivity.id,
          partySize: trip.intake.travelers,
          confirmedReview: true,
        }),
      });
      const payload = (await response.json()) as { trip?: TravelTrip; error?: string };
      if (!response.ok || !payload.trip) throw new Error(payload.error ?? "Booking request failed.");
      setTrip(payload.trip);
      const latest = payload.trip.bookings.at(-1);
      const tone = latest?.status === "blocked" ? "block" : latest?.status === "awaiting_approval" ? "warn" : "ok";
      setNotice({
        tone,
        title:
          latest?.status === "blocked"
            ? "Booking blocked"
            : latest?.status === "awaiting_approval"
              ? "Sent for approval"
              : "Pending booking request saved",
        text:
          latest?.note ??
          "WAVE has no reservation provider. This is not a confirmed table, ticket, or purchase.",
      });
      setBookingActivity(null);
      setConfirmBooking(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking request failed.");
    } finally {
      setWorking(null);
    }
  };

  const saveSettings = async () => {
    setWorking("settings");
    setError(null);
    try {
      const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/travel/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingThresholdInr: Number(thresholdDraft) }),
      });
      const payload = (await response.json()) as { bookingThresholdInr?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not save settings.");
      setThreshold(payload.bookingThresholdInr ?? Number(thresholdDraft));
      setNotice({
        tone: "ok",
        title: "Booking limit saved",
        text: `Bookings at or above ₹${(payload.bookingThresholdInr ?? Number(thresholdDraft)).toLocaleString("en-IN")} still require human approval on the server.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setWorking(null);
    }
  };

  const busy = generating || Boolean(working);
  const interestSet = useMemo(() => new Set(intake.interests ?? []), [intake.interests]);

  return (
    <PageShell maxWidth="6xl" className="lc-page">
      <header className="lc-header">
        <div>
          <Link href={`/agents/${encodeURIComponent(agentId)}`} className="lc-back">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Agent
          </Link>
          <p className="lc-kicker">Travel Companion for Local Discovery</p>
          <h1>{agentName}</h1>
          <p className="lc-lead">
            Plan a taste-informed itinerary. WAVE will not invent venues, prices, or confirmed bookings.
          </p>
        </div>
        <StatusBadge tone={agentStatus === "active" || agentStatus === "published" ? "success" : "warning"}>
          {agentStatus}
        </StatusBadge>
      </header>

      {loading ? (
        <p className="lc-loading">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading saved trip…
        </p>
      ) : null}

      {error ? (
        <ErrorState
          title="Travel Companion"
          description={error}
          onFix={() => {
            setError(null);
            void load();
          }}
        />
      ) : null}

      {notice ? (
        <Banner tone={notice.tone} title={notice.title}>
          {notice.text}
        </Banner>
      ) : null}

      <div className="lc-layout">
        <section className="lc-card">
          <div className="lc-card-head">
            <h2>Traveler preferences</h2>
            <p>Required trip details only. Optional tastes personalize Qloo queries when the key is set.</p>
          </div>
          <div className="lc-fields">
            <Field label="Destination" error={fieldErrors.destination}>
              <input
                className="ds-input"
                value={intake.destination ?? ""}
                onChange={(event) => setIntake((current) => ({ ...current, destination: event.target.value }))}
                placeholder="Jaipur"
              />
            </Field>
            <Field label="Travelers" error={fieldErrors.travelers}>
              <input
                className="ds-input"
                type="number"
                min={1}
                max={12}
                value={intake.travelers ?? 2}
                onChange={(event) => setIntake((current) => ({ ...current, travelers: Number(event.target.value) }))}
              />
            </Field>
            <Field label="Start date" error={fieldErrors.startDate}>
              <input
                className="ds-input"
                type="date"
                value={intake.startDate ?? ""}
                onChange={(event) => setIntake((current) => ({ ...current, startDate: event.target.value }))}
              />
            </Field>
            <Field label="End date" error={fieldErrors.endDate}>
              <input
                className="ds-input"
                type="date"
                value={intake.endDate ?? ""}
                onChange={(event) => setIntake((current) => ({ ...current, endDate: event.target.value }))}
              />
            </Field>
            <Field label="Budget" error={fieldErrors.budgetAmount}>
              <input
                className="ds-input"
                type="number"
                min={500}
                value={intake.budgetAmount ?? 18000}
                onChange={(event) => setIntake((current) => ({ ...current, budgetAmount: Number(event.target.value) }))}
              />
            </Field>
            <Field label="Currency" error={fieldErrors.budgetCurrency} hint="Non-INR budgets always need review.">
              <input
                className="ds-input"
                value={intake.budgetCurrency ?? "INR"}
                onChange={(event) => setIntake((current) => ({ ...current, budgetCurrency: event.target.value }))}
              />
            </Field>
            <Field label="Pace" error={fieldErrors.pace}>
              <select
                className="ds-select"
                value={intake.pace ?? "balanced"}
                onChange={(event) =>
                  setIntake((current) => ({ ...current, pace: event.target.value as TravelIntake["pace"] }))
                }
              >
                {PACES.map((pace) => (
                  <option key={pace} value={pace}>
                    {pace}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Starting area" hint="Optional">
              <input
                className="ds-input"
                value={intake.startingArea ?? ""}
                onChange={(event) => setIntake((current) => ({ ...current, startingArea: event.target.value }))}
              />
            </Field>
            <Field label="Interests" wide error={fieldErrors.interests}>
              <div className="tc-interests">
                {INTERESTS.map((interest) => (
                  <label key={interest} className="tc-chip">
                    <input
                      type="checkbox"
                      checked={interestSet.has(interest)}
                      onChange={(event) => {
                        setIntake((current) => {
                          const next = new Set(current.interests ?? []);
                          if (event.target.checked) next.add(interest);
                          else next.delete(interest);
                          return { ...current, interests: [...next] };
                        });
                      }}
                    />
                    {INTEREST_LABELS[interest]}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Favorite cuisines" hint="Optional">
              <input
                className="ds-input"
                value={intake.favoriteCuisines ?? ""}
                onChange={(event) => setIntake((current) => ({ ...current, favoriteCuisines: event.target.value }))}
              />
            </Field>
            <Field label="Cultural interests" hint="Optional">
              <input
                className="ds-input"
                value={intake.culturalInterests ?? ""}
                onChange={(event) => setIntake((current) => ({ ...current, culturalInterests: event.target.value }))}
              />
            </Field>
            <Field label="Dietary needs" hint="Optional">
              <input
                className="ds-input"
                value={intake.dietaryNeeds ?? ""}
                onChange={(event) => setIntake((current) => ({ ...current, dietaryNeeds: event.target.value }))}
              />
            </Field>
            <Field label="Accessibility" hint="Optional">
              <input
                className="ds-input"
                value={intake.accessibilityNeeds ?? ""}
                onChange={(event) => setIntake((current) => ({ ...current, accessibilityNeeds: event.target.value }))}
              />
            </Field>
            <Field label="Transport" hint="Optional">
              <select
                className="ds-select"
                value={intake.preferredTransport ?? "unspecified"}
                onChange={(event) =>
                  setIntake((current) => ({
                    ...current,
                    preferredTransport: event.target.value as TravelIntake["preferredTransport"],
                  }))
                }
              >
                {TRANSPORTS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Places to avoid" hint="Optional" wide>
              <input
                className="ds-input"
                value={intake.avoid ?? ""}
                onChange={(event) => setIntake((current) => ({ ...current, avoid: event.target.value }))}
              />
            </Field>
          </div>
          <div className="lc-submit tc-actions">
            <button
              type="button"
              className="ds-btn ds-btn-secondary"
              disabled={busy}
              onClick={() => setIntake({ ...SAMPLE_TRAVEL_INTAKE })}
            >
              Try Example
            </button>
            <button type="button" className="ds-btn ds-btn-primary" disabled={busy} onClick={() => void plan(false)}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {generating ? "Planning…" : "Plan trip"}
            </button>
            {trip ? (
              <button type="button" className="ds-btn ds-btn-secondary" disabled={busy} onClick={() => void plan(true)}>
                Replan Trip
              </button>
            ) : null}
          </div>
        </section>

        <aside className="lc-sidebar">
          <section className="lc-card">
            <div className="lc-card-head">
              <h2>
                <Shield className="h-4 w-4" aria-hidden="true" /> Agent settings
              </h2>
              <p>Booking amounts at or above this INR limit require a human reviewer. Enforcement stays on the server.</p>
            </div>
            <Field label="Approval threshold (INR)">
              <input
                className="ds-input"
                type="number"
                min={100}
                value={thresholdDraft}
                onChange={(event) => setThresholdDraft(event.target.value)}
              />
            </Field>
            <p className="lc-copy">Current saved limit: ₹{threshold.toLocaleString("en-IN")}.</p>
            <button type="button" className="ds-btn ds-btn-secondary lc-submit" disabled={busy} onClick={() => void saveSettings()}>
              Save booking limit
            </button>
          </section>
          <section className="lc-card">
            <div className="lc-card-head">
              <h2>Providers</h2>
            </div>
            <ul className="lc-list">
              <li>Qloo: taste tags and insights when QLOO_API_KEY is set.</li>
              <li>Places, maps, routing, tickets, tables: not configured.</li>
              <li>Payments: WAVE will not collect cards or charge money.</li>
            </ul>
          </section>
        </aside>
      </div>

      {trip ? (
        <section className="lc-card">
          <div className="lc-card-head">
            <h2>
              {trip.intake.destination}: {trip.intake.startDate} – {trip.intake.endDate}
            </h2>
            <p>
              Budget {money(trip.intake.budgetAmount, trip.intake.budgetCurrency)}. Planned spend{" "}
              {money(trip.itinerary.plannedSpendInr, trip.itinerary.currency)}. Remaining{" "}
              {money(trip.itinerary.remainingBudgetInr, trip.itinerary.currency)}.
            </p>
          </div>
          {trip.qloo.source !== "qloo" ? (
            <Banner tone="warn" title="Qloo personalization unavailable">
              {trip.qloo.error ?? "WAVE used stated preferences only. Recommendations are not invented Qloo results."}
            </Banner>
          ) : (
            <Banner tone="ok" title="Qloo-informed">
              Taste tags from GET /v2/tags and GET /v2/insights were used as affinity signals, not as verified venues.
            </Banner>
          )}
          {trip.itinerary.missingInformation.map((item) => (
            <p key={item} className="lc-copy">
              {item}
            </p>
          ))}
          <div className="tc-days" role="tablist" aria-label="Trip days">
            {trip.itinerary.days.map((day) => (
              <button
                key={day.date}
                type="button"
                className={`ds-btn ds-btn-sm ${day.index === dayIndex ? "ds-btn-primary" : "ds-btn-secondary"}`}
                onClick={() => setDayIndex(day.index)}
              >
                Day {day.index + 1} · {day.date}
              </button>
            ))}
            <button
              type="button"
              className="ds-btn ds-btn-sm ds-btn-secondary"
              disabled={busy}
              onClick={() => void mutate("regenerate_day")}
            >
              Regenerate day
            </button>
          </div>
          {selectedDay ? (
            <ol className="tc-timeline">
              {(["morning", "afternoon", "evening"] as const).map((part) => {
                const activities = selectedDay.activities.filter((activity) => activity.part === part);
                if (activities.length === 0) return null;
                return (
                  <li key={part} className="tc-part">
                    <h3>{part}</h3>
                    {activities.map((activity) => (
                      <article key={activity.id} className="tc-stop">
                        <header>
                          <strong>{activity.title}</strong>
                          <span>
                            {activity.startTime}–{activity.endTime}
                          </span>
                        </header>
                        <p>
                          {activity.category} · {activity.location} · {activity.durationMinutes} min ·{" "}
                          {money(activity.estimatedCostPerPerson, trip.itinerary.currency)} / person
                        </p>
                        <p>{activity.reason}</p>
                        <p className="tc-meta">
                          Availability: {activity.availability}. Hours verified: {activity.hoursVerified ? "yes" : "no"}.
                          Source: {activity.source}. Updated: {trip.itinerary.generatedAt}.
                        </p>
                        {activity.flags.map((flag) => (
                          <p key={flag} className="lc-copy">
                            {flag}
                          </p>
                        ))}
                        <div className="tc-actions">
                          <button
                            type="button"
                            className="ds-btn ds-btn-sm ds-btn-secondary"
                            disabled={busy}
                            onClick={() => void mutate("replace", activity.id)}
                          >
                            Replace
                          </button>
                          <button
                            type="button"
                            className="ds-btn ds-btn-sm ds-btn-secondary"
                            disabled={busy}
                            onClick={() => void mutate("remove", activity.id)}
                          >
                            Remove
                          </button>
                          {activity.bookingRequired ? (
                            <button
                              type="button"
                              className="ds-btn ds-btn-sm ds-btn-primary"
                              disabled={busy}
                              onClick={() => {
                                setBookingActivity(activity);
                                setConfirmBooking(false);
                              }}
                            >
                              Request Booking
                            </button>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </li>
                );
              })}
            </ol>
          ) : null}
        </section>
      ) : null}

      {bookingActivity && trip ? (
        <section className="lc-card">
          <div className="lc-card-head">
            <h2>Review booking request</h2>
            <p>No reservation provider is connected. Submitting stores a pending request only.</p>
          </div>
          <ul className="lc-list">
            <li>Activity: {bookingActivity.title}</li>
            <li>
              Date and time: {bookingActivity.dayDate} {bookingActivity.startTime}–{bookingActivity.endTime}
            </li>
            <li>Party size: {trip.intake.travelers}</li>
            <li>Price: {money(bookingActivity.estimatedCostPerPerson, trip.intake.budgetCurrency)} (unverified)</li>
            <li>Cancellation: unknown — no provider terms available.</li>
          </ul>
          <label className="lc-check">
            <input type="checkbox" checked={confirmBooking} onChange={(event) => setConfirmBooking(event.target.checked)} />
            I reviewed the activity, date, time, party size, and unverified price.
          </label>
          <div className="tc-actions">
            <button type="button" className="ds-btn ds-btn-secondary" onClick={() => setBookingActivity(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="ds-btn ds-btn-primary"
              disabled={!confirmBooking || busy}
              onClick={() => void requestBooking()}
            >
              Submit pending request
            </button>
          </div>
        </section>
      ) : null}

      {trip?.bookings.length ? (
        <section className="lc-card">
          <div className="lc-card-head">
            <h2>Booking requests</h2>
            <p>Statuses come from WAVE. None of these are purchased tickets or reserved tables.</p>
          </div>
          <ul className="lc-list">
            {trip.bookings.map((booking) => (
              <li key={booking.id}>
                {booking.title} · {booking.date} {booking.startTime}–{booking.endTime} · {bookingLabel(booking.status)} ·
                provider none · reference none
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {trip ? (
        <section className="lc-card">
          <div className="lc-card-head">
            <h2>Decision and audit history</h2>
          </div>
          <p className="lc-copy">
            {trip.safety.decision} · {trip.safety.actionType} · {trip.safety.reason} · {trip.safety.timestamp}
          </p>
          <p className="lc-copy">Policies: {trip.safety.policyRules.join(", ") || "none matched by name"}.</p>
          <p className="lc-copy">
            Approval: {trip.safety.approvalStatus}. Execution: {trip.safety.executionStatus}. Proposal:{" "}
            {trip.safety.proposalId ?? "none"}.
          </p>
        </section>
      ) : null}
    </PageShell>
  );
}
