"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2, Shield } from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import ErrorState from "@/components/ui/ErrorState";
import StatusBadge from "@/components/ui/StatusBadge";
import {
  EVENT_TYPES,
  INVITE_TONES,
  SAMPLE_WEDDING_INTAKE,
  VENDOR_CATEGORIES,
  VENUE_STYLES,
} from "@/lib/wedding-planner/constants";
import { weddingFieldErrors, weddingIntakeSchema } from "@/lib/wedding-planner/intake";
import type { WeddingEvent, WeddingIntake, WeddingVendor } from "@/lib/wedding-planner/types";

const STEPS = [
  { id: "event", label: "Event" },
  { id: "preferences", label: "Preferences" },
  { id: "plan", label: "Plan" },
  { id: "vendors", label: "Vendors" },
  { id: "schedule", label: "Schedule" },
  { id: "invite", label: "Invitation" },
  { id: "deposit", label: "Deposit" },
  { id: "done", label: "Done" },
] as const;

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

function Banner({ tone, title, children }: { tone: "ok" | "warn" | "block"; title: string; children: ReactNode }) {
  return (
    <div className={`lc-banner lc-banner-${tone}`} role="status">
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

function money(amount: number | null | undefined, currency: string): string {
  if (amount == null) return "Unknown";
  if (currency === "INR") return `₹${amount.toLocaleString("en-IN")}`;
  return `${amount.toLocaleString()} ${currency}`;
}

export default function WeddingPlannerPage() {
  const params = useParams();
  const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
  const [step, setStep] = useState(0);
  const [agentName, setAgentName] = useState("Wedding & Celebration Planner");
  const [agentStatus, setAgentStatus] = useState("draft");
  const [threshold, setThreshold] = useState(10000);
  const [thresholdDraft, setThresholdDraft] = useState("10000");
  const [event, setEvent] = useState<WeddingEvent | null>(null);
  const [comparison, setComparison] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "block"; title: string; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [intake, setIntake] = useState<Partial<WeddingIntake>>(SAMPLE_WEDDING_INTAKE);
  const [vendorForm, setVendorForm] = useState({
    name: "",
    category: "venue" as WeddingVendor["category"],
    quotedAmount: "",
    paymentRecipientId: "",
    location: "",
    servicesIncluded: "",
  });
  const [inviteForm, setInviteForm] = useState({
    tone: "warm" as (typeof INVITE_TONES)[number],
    hostNames: "",
    venueName: "",
    extraWording: "",
  });
  const [depositForm, setDepositForm] = useState({ vendorId: "", amount: "", recipientId: "", confirmed: false });
  const [taskTitle, setTaskTitle] = useState("");

  const applyWorkspace = (payload: {
    agentName?: string;
    status?: string;
    depositThresholdInr?: number;
    event?: WeddingEvent | null;
    comparison?: string[];
  }) => {
    setAgentName(payload.agentName ?? "Wedding & Celebration Planner");
    setAgentStatus(payload.status ?? "draft");
    setThreshold(payload.depositThresholdInr ?? 10000);
    setThresholdDraft(String(payload.depositThresholdInr ?? 10000));
    if (payload.event) setEvent(payload.event);
    if (payload.comparison) setComparison(payload.comparison);
    if (payload.event?.intake) setIntake((current) => ({ ...current, ...payload.event?.intake }));
  };

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/wedding`);
      const payload = (await response.json()) as {
        agentName?: string;
        status?: string;
        depositThresholdInr?: number;
        event?: WeddingEvent | null;
        comparison?: string[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Could not load Wedding Planner.");
      applyWorkspace(payload);
      setEvent(payload.event ?? null);
      setComparison(payload.comparison ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Wedding Planner.");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  const postJson = async (path: string, body: unknown) => {
    const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    const payload = (await response.json()) as { event?: WeddingEvent; error?: string; depositThresholdInr?: number };
    if (!response.ok) throw new Error(payload.error ?? "Request failed.");
    if (payload.event) setEvent(payload.event);
    if (payload.depositThresholdInr) {
      setThreshold(payload.depositThresholdInr);
      setThresholdDraft(String(payload.depositThresholdInr));
    }
    return payload;
  };

  const refreshComparison = async () => {
    const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/wedding`);
    if (!response.ok) return;
    const payload = (await response.json()) as { comparison?: string[]; event?: WeddingEvent | null };
    setComparison(payload.comparison ?? []);
    if (payload.event) setEvent(payload.event);
  };

  const parsedIntake = (saveDraft: boolean) => {
    const couplePreferences =
      (intake.couplePreferences ?? "").trim().length >= 8
        ? intake.couplePreferences
        : saveDraft
          ? "To be completed on the next step."
          : intake.couplePreferences;
    const parsed = weddingIntakeSchema.safeParse({ ...intake, couplePreferences, isDraft: saveDraft });
    if (!parsed.success) {
      setFieldErrors(weddingFieldErrors(parsed.error));
      throw new Error(parsed.error.issues[0]?.message ?? "Check the setup form.");
    }
    setFieldErrors({});
    return parsed.data;
  };

  const saveEvent = async (saveDraft: boolean) => {
    const data = parsedIntake(saveDraft);
    const payload = await postJson("wedding", { ...data, eventId: event?.id, saveDraft });
    setNotice({
      tone: "ok",
      title: saveDraft ? "Draft saved" : "Plan saved",
      text: saveDraft
        ? "You can continue later. This step is stored on the event."
        : "Recommendations use only the preferences you entered. WAVE did not call Qloo or invent vendors.",
    });
    return payload.event ?? null;
  };

  const goNext = async () => {
    setWorking("next");
    setError(null);
    try {
      if (step === 0) {
        await saveEvent(true);
        setStep(1);
        return;
      }
      if (step === 1) {
        await saveEvent(false);
        setStep(2);
        return;
      }
      if (step === 6) {
        setNotice({
          tone: "ok",
          title: "Planner finished",
          text: "The event, vendors, and safety checks are saved. Deposits stay unpaid until a payout provider is connected.",
        });
        setStep(7);
        return;
      }
      setStep((current) => Math.min(current + 1, STEPS.length - 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue.");
    } finally {
      setWorking(null);
    }
  };

  const busy = Boolean(working);
  const current = STEPS[step];
  const lastWorkingStep = STEPS.length - 2;

  return (
    <PageShell maxWidth="4xl" className="lc-page">
      <header className="lc-header">
        <div>
          <Link href={`/agents/${encodeURIComponent(agentId)}`} className="lc-back">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Agent
          </Link>
          <p className="lc-kicker">Wedding & Celebration Planner</p>
          <h1>{agentName}</h1>
          <p className="lc-lead">One step at a time. Each Next button saves to WAVE.</p>
        </div>
        <StatusBadge tone={agentStatus === "active" || agentStatus === "published" ? "success" : "warning"}>
          {agentStatus}
        </StatusBadge>
      </header>

      <ol className="lc-wizard-progress" aria-label="Planner steps">
        {STEPS.map((item, index) => (
          <li key={item.id} className={index === step ? "is-current" : index < step ? "is-done" : undefined}>
            {index + 1}. {item.label}
          </li>
        ))}
      </ol>

      {loading ? (
        <p className="lc-loading">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading saved event…
        </p>
      ) : null}
      {error ? <ErrorState title="Wedding Planner" description={error} onFix={() => void load()} /> : null}
      {notice && step !== 7 ? (
        <Banner tone={notice.tone} title={notice.title}>
          {notice.text}
        </Banner>
      ) : null}

      {current?.id === "event" ? (
        <section className="lc-card">
          <div className="lc-card-head">
            <h2>Event details</h2>
            <p>Required fields. Family notes come on the next screen.</p>
          </div>
          <div className="lc-fields">
            <Field label="Event name" error={fieldErrors.eventName}>
              <input className="ds-input" value={intake.eventName ?? ""} onChange={(e) => setIntake((c) => ({ ...c, eventName: e.target.value }))} />
            </Field>
            <Field label="Event type" error={fieldErrors.eventType}>
              <select className="ds-select" value={intake.eventType ?? "wedding"} onChange={(e) => setIntake((c) => ({ ...c, eventType: e.target.value as WeddingIntake["eventType"] }))}>
                {EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Start date" error={fieldErrors.startDate}>
              <input className="ds-input" type="date" value={intake.startDate ?? ""} onChange={(e) => setIntake((c) => ({ ...c, startDate: e.target.value }))} />
            </Field>
            <Field label="End date" hint="Optional">
              <input className="ds-input" type="date" value={intake.endDate ?? ""} onChange={(e) => setIntake((c) => ({ ...c, endDate: e.target.value }))} />
            </Field>
            <Field label="City or location" error={fieldErrors.location}>
              <input className="ds-input" value={intake.location ?? ""} onChange={(e) => setIntake((c) => ({ ...c, location: e.target.value }))} />
            </Field>
            <Field label="Guest count" error={fieldErrors.guestCount}>
              <input className="ds-input" type="number" min={2} value={intake.guestCount ?? 2} onChange={(e) => setIntake((c) => ({ ...c, guestCount: Number(e.target.value) }))} />
            </Field>
            <Field label="Total budget (INR)" error={fieldErrors.budgetAmount}>
              <input className="ds-input" type="number" min={1000} value={intake.budgetAmount ?? 1000} onChange={(e) => setIntake((c) => ({ ...c, budgetAmount: Number(e.target.value) }))} />
            </Field>
          </div>
          <div className="tc-actions">
            <button type="button" className="ds-btn ds-btn-secondary" disabled={busy} onClick={() => setIntake({ ...SAMPLE_WEDDING_INTAKE })}>
              Load sample
            </button>
          </div>
        </section>
      ) : null}

      {current?.id === "preferences" ? (
        <section className="lc-card">
          <div className="lc-card-head">
            <h2>Preferences</h2>
            <p>WAVE only uses what you type. Family notes stay separate from the couple.</p>
          </div>
          <div className="lc-fields">
            <Field label="Venue style">
              <select className="ds-select" value={intake.venueStyle ?? "garden"} onChange={(e) => setIntake((c) => ({ ...c, venueStyle: e.target.value as WeddingIntake["venueStyle"] }))}>
                {VENUE_STYLES.map((style) => (
                  <option key={style} value={style}>
                    {style}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Couple or organizer preferences" wide error={fieldErrors.couplePreferences}>
              <textarea className="ds-textarea" value={intake.couplePreferences ?? ""} onChange={(e) => setIntake((c) => ({ ...c, couplePreferences: e.target.value }))} />
            </Field>
            <Field label="Family preferences" hint="Optional. WAVE will not override the couple." wide>
              <textarea className="ds-textarea" value={intake.familyPreferences ?? ""} onChange={(e) => setIntake((c) => ({ ...c, familyPreferences: e.target.value }))} />
            </Field>
            <Field label="Cuisine">
              <input className="ds-input" value={intake.cuisine ?? ""} onChange={(e) => setIntake((c) => ({ ...c, cuisine: e.target.value }))} />
            </Field>
            <Field label="Music">
              <input className="ds-input" value={intake.music ?? ""} onChange={(e) => setIntake((c) => ({ ...c, music: e.target.value }))} />
            </Field>
            <Field label="Décor palette">
              <input className="ds-input" value={intake.decorPalette ?? ""} onChange={(e) => setIntake((c) => ({ ...c, decorPalette: e.target.value }))} />
            </Field>
            <Field label="Photography style">
              <input className="ds-input" value={intake.photographyStyle ?? ""} onChange={(e) => setIntake((c) => ({ ...c, photographyStyle: e.target.value }))} />
            </Field>
            <Field label="Traditions" wide>
              <input className="ds-input" value={intake.traditions ?? ""} onChange={(e) => setIntake((c) => ({ ...c, traditions: e.target.value }))} />
            </Field>
          </div>
        </section>
      ) : null}

      {current?.id === "plan" ? (
        <section className="lc-card">
          <div className="lc-card-head">
            <h2>Recommendations from stated preferences</h2>
            <p>Rules-based. No Qloo. Style briefs are not verified businesses.</p>
          </div>
          {event?.plan ? (
            <>
              {event.plan.sharedPreferences.map((item) => (
                <p key={item} className="lc-copy">
                  {item}
                </p>
              ))}
              {event.plan.differingPreferences.map((item) => (
                <p key={item} className="lc-copy">
                  {item}
                </p>
              ))}
              <ul className="lc-list">
                {event.plan.recommendations.map((item) => (
                  <li key={item.id}>
                    <strong>{item.title}</strong> — {item.reason}
                    {item.assumption ? " (assumption flagged)" : ""}
                  </li>
                ))}
              </ul>
              {event.plan.followUps.length ? (
                <Banner tone="warn" title="Missing information">
                  {event.plan.followUps.join(" ")}
                </Banner>
              ) : null}
            </>
          ) : (
            <p className="lc-copy">Go back and choose Next on Preferences to generate a saved plan.</p>
          )}
        </section>
      ) : null}

      {current?.id === "vendors" ? (
        <section className="lc-card">
          <div className="lc-card-head">
            <h2>Vendors and budget</h2>
            <p>Enter real vendors and quotes. WAVE will not invent a business, phone number, or availability.</p>
          </div>
          {event ? (
            <>
              <dl className="lc-rates">
                <div>
                  <dt>Total</dt>
                  <dd>{money(event.budget.total, event.budget.currency)}</dd>
                </div>
                <div>
                  <dt>Planned quotes</dt>
                  <dd>{money(event.budget.planned, event.budget.currency)}</dd>
                </div>
                <div>
                  <dt>Remaining</dt>
                  <dd>{money(event.budget.remaining, event.budget.currency)}</dd>
                </div>
              </dl>
              <div className="lc-fields">
                <Field label="Business name">
                  <input className="ds-input" value={vendorForm.name} onChange={(e) => setVendorForm((c) => ({ ...c, name: e.target.value }))} />
                </Field>
                <Field label="Category">
                  <select className="ds-select" value={vendorForm.category} onChange={(e) => setVendorForm((c) => ({ ...c, category: e.target.value as WeddingVendor["category"] }))}>
                    {VENDOR_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Quoted amount">
                  <input className="ds-input" type="number" value={vendorForm.quotedAmount} onChange={(e) => setVendorForm((c) => ({ ...c, quotedAmount: e.target.value }))} />
                </Field>
                <Field label="Payment recipient ID" hint="Required before a deposit can leave review/block checks">
                  <input className="ds-input" value={vendorForm.paymentRecipientId} onChange={(e) => setVendorForm((c) => ({ ...c, paymentRecipientId: e.target.value }))} />
                </Field>
                <Field label="Location">
                  <input className="ds-input" value={vendorForm.location} onChange={(e) => setVendorForm((c) => ({ ...c, location: e.target.value }))} />
                </Field>
                <Field label="Services included" wide>
                  <input className="ds-input" value={vendorForm.servicesIncluded} onChange={(e) => setVendorForm((c) => ({ ...c, servicesIncluded: e.target.value }))} />
                </Field>
              </div>
              <button
                type="button"
                className="ds-btn ds-btn-primary lc-submit"
                disabled={busy}
                onClick={async () => {
                  setWorking("vendor");
                  setError(null);
                  try {
                    await postJson("wedding/vendor", {
                      eventId: event.id,
                      name: vendorForm.name,
                      category: vendorForm.category,
                      quotedAmount: vendorForm.quotedAmount === "" ? null : Number(vendorForm.quotedAmount),
                      currency: event.intake.budgetCurrency,
                      paymentRecipientId: vendorForm.paymentRecipientId || undefined,
                      location: vendorForm.location || undefined,
                      servicesIncluded: vendorForm.servicesIncluded || undefined,
                    });
                    setVendorForm({
                      name: "",
                      category: vendorForm.category,
                      quotedAmount: "",
                      paymentRecipientId: "",
                      location: "",
                      servicesIncluded: "",
                    });
                    await refreshComparison();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not add vendor.");
                  } finally {
                    setWorking(null);
                  }
                }}
              >
                Add vendor
              </button>
              {comparison.map((note) => (
                <p key={note} className="lc-copy">
                  {note}
                </p>
              ))}
              {VENDOR_CATEGORIES.map((category) => {
                const vendors = event.vendors.filter((vendor) => vendor.category === category);
                if (!vendors.length) return null;
                return (
                  <div key={category}>
                    <h3 className="lc-copy">{category}</h3>
                    <ul className="lc-list">
                      {vendors.map((vendor) => (
                        <li key={vendor.id}>
                          {vendor.name} · {money(vendor.quotedAmount, vendor.currency)} · {vendor.allowlistStatus} · availability {vendor.availability} · unverified · recipient {vendor.paymentRecipientId ?? "missing"}
                          <div className="tc-actions">
                            {vendor.allowlistStatus !== "approved" ? (
                              <button
                                type="button"
                                className="ds-btn ds-btn-sm ds-btn-secondary"
                                disabled={busy}
                                onClick={async () => {
                                  await postJson("wedding/vendor", { eventId: event.id, vendorId: vendor.id, action: "approve" });
                                  await refreshComparison();
                                }}
                              >
                                Add to allowlist
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="ds-btn ds-btn-sm ds-btn-secondary"
                              disabled={busy}
                              onClick={async () => {
                                await postJson("wedding/vendor", { eventId: event.id, vendorId: vendor.id, action: "remove" });
                                await refreshComparison();
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </>
          ) : (
            <p className="lc-copy">Save the event first so vendors can attach to it.</p>
          )}
        </section>
      ) : null}

      {current?.id === "schedule" ? (
        <section className="lc-card">
          <div className="lc-card-head">
            <h2>Checklist and schedule</h2>
          </div>
          {event ? (
            <>
              {event.conflicts.map((conflict) => (
                <Banner key={conflict} tone="block" title="Schedule conflict">
                  {conflict}
                </Banner>
              ))}
              <ul className="lc-list">
                {event.tasks.map((task) => (
                  <li key={task.id}>
                    <label className="lc-check">
                      <input type="checkbox" checked={task.done} onChange={() => void postJson("wedding/task", { eventId: event.id, taskId: task.id, action: "toggle" })} />
                      {task.title}
                      {task.dueDate ? ` · ${task.dueDate}` : ""}
                    </label>
                    <button type="button" className="ds-btn ds-btn-sm ds-btn-secondary" onClick={() => void postJson("wedding/task", { eventId: event.id, taskId: task.id, action: "remove" })}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <div className="tc-actions">
                <input className="ds-input" placeholder="New task" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
                <button
                  type="button"
                  className="ds-btn ds-btn-secondary"
                  disabled={busy || !taskTitle.trim()}
                  onClick={() => {
                    void postJson("wedding/task", { eventId: event.id, title: taskTitle });
                    setTaskTitle("");
                  }}
                >
                  Add task
                </button>
              </div>
            </>
          ) : (
            <p className="lc-copy">Save the event first to add tasks.</p>
          )}
        </section>
      ) : null}

      {current?.id === "invite" ? (
        <section className="lc-card">
          <div className="lc-card-head">
            <h2>Invitation draft</h2>
            <p>Preview only. WAVE will not claim an invitation was sent.</p>
          </div>
          {event ? (
            <>
              <div className="lc-fields">
                <Field label="Host names">
                  <input className="ds-input" value={inviteForm.hostNames} onChange={(e) => setInviteForm((c) => ({ ...c, hostNames: e.target.value }))} />
                </Field>
                <Field label="Tone">
                  <select className="ds-select" value={inviteForm.tone} onChange={(e) => setInviteForm((c) => ({ ...c, tone: e.target.value as typeof inviteForm.tone }))}>
                    {INVITE_TONES.map((tone) => (
                      <option key={tone} value={tone}>
                        {tone}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Venue name">
                  <input className="ds-input" value={inviteForm.venueName} onChange={(e) => setInviteForm((c) => ({ ...c, venueName: e.target.value }))} />
                </Field>
                <Field label="Extra wording" wide>
                  <input className="ds-input" value={inviteForm.extraWording} onChange={(e) => setInviteForm((c) => ({ ...c, extraWording: e.target.value }))} />
                </Field>
              </div>
              <button
                type="button"
                className="ds-btn ds-btn-primary lc-submit"
                disabled={busy}
                onClick={() => void postJson("wedding/invite", { eventId: event.id, ...inviteForm })}
              >
                Generate invitation draft
              </button>
              {event.invitation ? <pre className="lc-result">{event.invitation.draft}</pre> : null}
            </>
          ) : (
            <p className="lc-copy">Save the event first to draft an invitation.</p>
          )}
        </section>
      ) : null}

      {current?.id === "deposit" ? (
        <section className="lc-card">
          <div className="lc-card-head">
            <h2>
              <Shield className="h-4 w-4" /> Deposit and safety
            </h2>
            <p>Default threshold ₹{threshold.toLocaleString("en-IN")}. No payout provider is connected, so nothing is marked paid.</p>
          </div>
          <Field label="Approval threshold (INR)">
            <input className="ds-input" type="number" min={100} value={thresholdDraft} onChange={(e) => setThresholdDraft(e.target.value)} />
          </Field>
          <button
            type="button"
            className="ds-btn ds-btn-secondary lc-submit"
            disabled={busy}
            onClick={() => void postJson("wedding/settings", { depositThresholdInr: Number(thresholdDraft) })}
          >
            Save threshold
          </button>
          {event ? (
            <>
              <div className="lc-fields">
                <Field label="Vendor">
                  <select className="ds-select" value={depositForm.vendorId} onChange={(e) => setDepositForm((c) => ({ ...c, vendorId: e.target.value }))}>
                    <option value="">Select</option>
                    {event.vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendor.name} ({vendor.allowlistStatus})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Amount">
                  <input className="ds-input" type="number" value={depositForm.amount} onChange={(e) => setDepositForm((c) => ({ ...c, amount: e.target.value }))} />
                </Field>
                <Field label="Payment recipient ID">
                  <input className="ds-input" value={depositForm.recipientId} onChange={(e) => setDepositForm((c) => ({ ...c, recipientId: e.target.value }))} />
                </Field>
              </div>
              <label className="lc-check">
                <input type="checkbox" checked={depositForm.confirmed} onChange={(e) => setDepositForm((c) => ({ ...c, confirmed: e.target.checked }))} />
                I reviewed the vendor, amount, recipient, and quote. This will not mark a payment as paid.
              </label>
              <button
                type="button"
                className="ds-btn ds-btn-primary"
                disabled={busy || !depositForm.confirmed}
                onClick={async () => {
                  setWorking("deposit");
                  setError(null);
                  try {
                    await postJson("wedding/deposit", {
                      eventId: event.id,
                      vendorId: depositForm.vendorId,
                      amount: Number(depositForm.amount),
                      recipientId: depositForm.recipientId,
                      confirmedReview: true,
                    });
                    setNotice({
                      tone: "warn",
                      title: "Deposit request submitted",
                      text: "Check the safety panel. WAVE never reports a vendor deposit as paid without a payment provider.",
                    });
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Deposit request failed.");
                  } finally {
                    setWorking(null);
                  }
                }}
              >
                Request deposit
              </button>
              <ul className="lc-list">
                {event.deposits.map((deposit) => (
                  <li key={deposit.id}>
                    {deposit.vendorName} · {money(deposit.amount, deposit.currency)} · {deposit.status} · provider none · reference none
                  </li>
                ))}
              </ul>
              <p className="lc-copy">
                {event.safety.decision} · amount {money(event.safety.estimatedAmountInr, "INR")} · threshold ₹{threshold.toLocaleString("en-IN")} · allowlist {event.safety.allowlistStatus ?? "n/a"} · quote {event.safety.quoteVerified ? "present" : "missing/unknown"} · recipient {event.safety.recipientVerified ? "matched" : "unverified"} · approval {event.safety.approvalStatus} · execution {event.safety.executionStatus}
              </p>
              <p className="lc-copy">{event.safety.reason}</p>
            </>
          ) : (
            <p className="lc-copy">Save the event first to request a deposit.</p>
          )}
        </section>
      ) : null}

      {current?.id === "done" ? (
        <section className="lc-card lc-success">
          <CheckCircle2 className="lc-success-icon" aria-hidden="true" />
          <h2>Event saved</h2>
          <p className="lc-lead">
            {event?.intake.eventName ?? "Your celebration"} is stored on this WAVE agent. WAVE did not invent vendors or mark any deposit as paid.
          </p>
          {event ? (
            <dl className="lc-rates">
              <div>
                <dt>Location</dt>
                <dd>{event.intake.location}</dd>
              </div>
              <div>
                <dt>Guests</dt>
                <dd>{event.intake.guestCount}</dd>
              </div>
              <div>
                <dt>Budget remaining</dt>
                <dd>{money(event.budget.remaining, event.budget.currency)}</dd>
              </div>
              <div>
                <dt>Vendors entered</dt>
                <dd>{event.vendors.length}</dd>
              </div>
              <div>
                <dt>Deposit requests</dt>
                <dd>{event.deposits.length}</dd>
              </div>
              <div>
                <dt>Latest safety decision</dt>
                <dd>{event.safety.decision}</dd>
              </div>
            </dl>
          ) : null}
          <div className="lc-wizard-nav">
            <button type="button" className="ds-btn ds-btn-secondary" onClick={() => setStep(0)}>
              Edit event
            </button>
            <Link href={`/agents/${encodeURIComponent(agentId)}`} className="ds-btn ds-btn-primary">
              Back to agent
            </Link>
          </div>
        </section>
      ) : null}

      {step <= lastWorkingStep ? (
        <div className="lc-wizard-nav">
          {step > 0 ? (
            <button type="button" className="ds-btn ds-btn-secondary" disabled={busy} onClick={() => setStep((current) => current - 1)}>
              Back
            </button>
          ) : null}
          <button type="button" className="ds-btn ds-btn-primary" disabled={busy || loading} onClick={() => void goNext()}>
            {working === "next" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {step === lastWorkingStep ? "Finish" : "Next"}
          </button>
        </div>
      ) : null}
    </PageShell>
  );
}
