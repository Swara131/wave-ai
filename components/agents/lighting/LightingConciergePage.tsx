"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2, Shield } from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import ErrorState from "@/components/ui/ErrorState";
import StatusBadge from "@/components/ui/StatusBadge";
import type { LightingIntake } from "@/lib/lighting-concierge/types";
import type { LightingJob, LightingRates } from "@/lib/lighting-concierge/types";
import {
  JOB_KINDS,
  LIGHTING_PREFERENCES,
  ROOM_TYPES,
  STYLE_OPTIONS,
} from "@/lib/lighting-concierge/constants";
import {
  lightingIntakeFieldErrors,
  lightingIntakeSchema,
} from "@/lib/lighting-concierge/intake";

const ROOM_LABELS: Record<(typeof ROOM_TYPES)[number], string> = {
  living_room: "Living room",
  bedroom: "Bedroom",
  kitchen: "Kitchen",
  bathroom: "Bathroom",
  office: "Office",
  outdoor: "Outdoor",
  other: "Other",
};

const JOB_LABELS: Record<(typeof JOB_KINDS)[number], string> = {
  new_installation: "New installation",
  replacement: "Replacement",
  consultation: "Consultation",
};

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

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

export default function LightingConciergePage() {
  const params = useParams();
  const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
  const [agentName, setAgentName] = useState("Lighting Concierge");
  const [agentStatus, setAgentStatus] = useState("draft");
  const [rates, setRates] = useState<LightingRates | null>(null);
  const [job, setJob] = useState<LightingJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "block"; title: string; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lastAction, setLastAction] = useState<"load" | "generate" | "verify" | "visit">("load");
  const [confirmVisit, setConfirmVisit] = useState(false);
  const [intake, setIntake] = useState<Partial<LightingIntake>>({
    roomType: "living_room",
    preferredStyle: "modern",
    lightingPreference: "warm",
    jobKind: "new_installation",
    budgetInr: 12000,
  });

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/lighting`);
      const payload = (await response.json()) as {
        agentName?: string;
        status?: string;
        rates?: LightingRates;
        job?: LightingJob | null;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Could not load Lighting Concierge.");
      setAgentName(payload.agentName ?? "Lighting Concierge");
      setAgentStatus(payload.status ?? "draft");
      setRates(payload.rates ?? null);
      setJob(payload.job ?? null);
      if (payload.job?.intake) {
        setIntake((current) => ({ ...current, ...payload.job?.intake }));
      }
      setError(null);
      setNotice(null);
    } catch (err) {
      setLastAction("load");
      setError(err instanceof Error ? err.message : "Could not load Lighting Concierge.");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    setGenerating(true);
    setLastAction("generate");
    setError(null);
    setNotice(null);
    setFieldErrors({});
    try {
      const parsed = lightingIntakeSchema.safeParse({
        customerName: intake.customerName ?? "",
        contactEmail: intake.contactEmail || "",
        contactPhone: intake.contactPhone || "",
        roomType: intake.roomType ?? "living_room",
        roomPurpose: intake.roomPurpose?.trim() || `${(intake.roomType ?? "living_room").replaceAll("_", " ")} lighting plan`,
        preferredStyle: intake.preferredStyle ?? "modern",
        lightingPreference: intake.lightingPreference ?? "warm",
        budgetInr: intake.budgetInr || 12000,
        serviceAddress: intake.serviceAddress ?? "",
        jobKind: intake.jobKind ?? "new_installation",
        ...(intake.roomDimensions ? { roomDimensions: intake.roomDimensions } : {}),
        ...(intake.ceilingHeight ? { ceilingHeight: intake.ceilingHeight } : {}),
        ...(intake.existingFixtures ? { existingFixtures: intake.existingFixtures } : {}),
        ...(intake.lightsNeeded ? { lightsNeeded: intake.lightsNeeded } : {}),
        ...(intake.preferredAppointmentAt
          ? { preferredAppointmentAt: intake.preferredAppointmentAt }
          : {}),
        ...(intake.additionalPreferences
          ? { additionalPreferences: intake.additionalPreferences }
          : {}),
      });
      if (!parsed.success) {
        setFieldErrors(lightingIntakeFieldErrors(parsed.error));
        throw new Error(parsed.error.issues[0]?.message ?? "Check the intake form and try again.");
      }

      const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/lighting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(45_000),
      });
      const payload = (await response.json()) as {
        job?: LightingJob;
        error?: string;
        details?: string[];
      };
      if (!response.ok) {
        throw new Error(payload.details?.[0] ?? payload.error ?? "Could not generate a lighting plan.");
      }
      if (!payload.job) throw new Error("The server did not return a lighting plan.");
      setJob(payload.job);
      setNotice({
        tone: payload.job.safety.decision === "BLOCK" ? "block" : payload.job.safety.decision === "REVIEW" ? "warn" : "ok",
        title: "Lighting plan saved",
        text:
          payload.job.safety.decision === "ALLOW"
            ? "The plan, estimate, and safety decision were saved. Refreshing this page will keep them."
            : payload.job.safety.reason,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate a lighting plan.");
    } finally {
      setGenerating(false);
    }
  };

  const postAction = async (path: string, body: Record<string, unknown>, label: "verify" | "visit") => {
    setWorking(label);
    setLastAction(label);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/lighting/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });
      const payload = (await response.json()) as { job?: LightingJob; error?: string; details?: string[] };
      if (!response.ok) throw new Error(payload.details?.[0] ?? payload.error ?? "Request failed.");
      if (!payload.job) throw new Error("The server did not return an updated job.");
      setJob(payload.job);
      if (label === "verify") {
        setNotice({
          tone: "warn",
          title: "Address verification requested",
          text: "WAVE has no address-verification provider. An authorised reviewer must confirm the address. A typed address is not verified.",
        });
      } else if (payload.job.safety.decision === "BLOCK") {
        setNotice({
          tone: "block",
          title: "Visit request blocked",
          text: payload.job.appointment.note ?? payload.job.safety.reason,
        });
      } else if (payload.job.appointment.status === "awaiting_approval") {
        setNotice({
          tone: "warn",
          title: "Visit request waiting for approval",
          text: payload.job.appointment.note ?? payload.job.safety.reason,
        });
      } else {
        setNotice({
          tone: "ok",
          title: "Electrician visit requested",
          text: payload.job.appointment.note ?? "Stored as pending confirmation. This is not a booked appointment.",
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setWorking(null);
    }
  };

  if (loading) {
    return (
      <PageShell maxWidth="7xl" className="lc-page">
        <p className="lc-kicker">Lighting Concierge</p>
        <p className="lc-loading">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading workspace…
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell maxWidth="7xl" className="lc-page">
      <header className="lc-header">
        <div>
          <Link href={`/agents/${encodeURIComponent(agentId)}/setup`} className="lc-back">
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            Back to setup
          </Link>
          <p className="lc-kicker">Home services</p>
          <h1>{agentName}</h1>
          <p className="lc-lead">
            Collect a customer intake, estimate from your rate table, and request an electrician visit with WAVE
            safety checks.
          </p>
        </div>
        <StatusBadge tone={agentStatus === "active" || agentStatus === "published" ? "success" : "warning"}>
          {agentStatus}
        </StatusBadge>
      </header>

      {error ? (
        <ErrorState
          title="Lighting Concierge"
          description={error}
          onFix={() => {
            setError(null);
            if (lastAction === "verify") {
              if (job) void postAction("verify-address", { jobId: job.id }, "verify");
              return;
            }
            if (lastAction === "visit") {
              if (job) {
                void postAction(
                  "request-visit",
                  {
                    jobId: job.id,
                    customerConfirmed: true,
                    preferredAppointmentAt: intake.preferredAppointmentAt,
                  },
                  "visit"
                );
              }
              return;
            }
            if (lastAction === "load") {
              void load();
              return;
            }
            void generate();
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
            <h2>Customer intake</h2>
            <p>
              WAVE needs the service address later to send an electrician. Typing it here does not verify it.
            </p>
          </div>
          <div className="lc-fields">
            <Field label="Customer name" error={fieldErrors.customerName}>
              <input
                className="ds-input"
                value={intake.customerName ?? ""}
                onChange={(event) => setIntake((current) => ({ ...current, customerName: event.target.value }))}
              />
            </Field>
            <Field label="Contact email" error={fieldErrors.contactEmail}>
              <input
                className="ds-input"
                type="email"
                value={intake.contactEmail ?? ""}
                onChange={(event) => setIntake((current) => ({ ...current, contactEmail: event.target.value }))}
              />
            </Field>
            <Field label="Contact phone" error={fieldErrors.contactPhone}>
              <input
                className="ds-input"
                value={intake.contactPhone ?? ""}
                onChange={(event) => setIntake((current) => ({ ...current, contactPhone: event.target.value }))}
              />
            </Field>
            <Field label="Room type">
              <select
                className="ds-select"
                value={intake.roomType}
                onChange={(event) =>
                  setIntake((current) => ({
                    ...current,
                    roomType: event.target.value as LightingIntake["roomType"],
                  }))
                }
              >
                {ROOM_TYPES.map((room) => (
                  <option key={room} value={room}>
                    {ROOM_LABELS[room]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Room purpose and description" wide>
              <textarea
                className="ds-textarea"
                rows={3}
                value={intake.roomPurpose ?? ""}
                onChange={(event) => setIntake((current) => ({ ...current, roomPurpose: event.target.value }))}
              />
            </Field>
            <Field label="Preferred style">
              <select
                className="ds-select"
                value={intake.preferredStyle}
                onChange={(event) =>
                  setIntake((current) => ({
                    ...current,
                    preferredStyle: event.target.value as LightingIntake["preferredStyle"],
                  }))
                }
              >
                {STYLE_OPTIONS.map((style) => (
                  <option key={style} value={style}>
                    {style}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Lighting preference">
              <select
                className="ds-select"
                value={intake.lightingPreference}
                onChange={(event) =>
                  setIntake((current) => ({
                    ...current,
                    lightingPreference: event.target.value as LightingIntake["lightingPreference"],
                  }))
                }
              >
                {LIGHTING_PREFERENCES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Budget (INR)" error={fieldErrors.budgetInr}>
              <input
                className="ds-input"
                type="number"
                min={0}
                value={intake.budgetInr ?? ""}
                onChange={(event) =>
                  setIntake((current) => ({ ...current, budgetInr: Number(event.target.value) }))
                }
              />
            </Field>
            <Field label="Job type">
              <select
                className="ds-select"
                value={intake.jobKind}
                onChange={(event) =>
                  setIntake((current) => ({ ...current, jobKind: event.target.value as LightingIntake["jobKind"] }))
                }
              >
                {JOB_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {JOB_LABELS[kind]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Service address" wide hint="Typed here is not a verified address." error={fieldErrors.serviceAddress}>
              <textarea
                className="ds-textarea"
                rows={3}
                value={intake.serviceAddress ?? ""}
                onChange={(event) => setIntake((current) => ({ ...current, serviceAddress: event.target.value }))}
              />
            </Field>
            <Field label="Room dimensions" hint="Optional">
              <input
                className="ds-input"
                value={intake.roomDimensions ?? ""}
                onChange={(event) => setIntake((current) => ({ ...current, roomDimensions: event.target.value }))}
              />
            </Field>
            <Field label="Ceiling height" hint="Optional">
              <input
                className="ds-input"
                value={intake.ceilingHeight ?? ""}
                onChange={(event) => setIntake((current) => ({ ...current, ceilingHeight: event.target.value }))}
              />
            </Field>
            <Field label="Existing lights" hint="Optional">
              <input
                className="ds-input"
                value={intake.existingFixtures ?? ""}
                onChange={(event) => setIntake((current) => ({ ...current, existingFixtures: event.target.value }))}
              />
            </Field>
            <Field label="Number of lights needed" hint="Optional">
              <input
                className="ds-input"
                type="number"
                min={0}
                value={intake.lightsNeeded ?? ""}
                onChange={(event) =>
                  setIntake((current) => ({
                    ...current,
                    lightsNeeded: event.target.value ? Number(event.target.value) : undefined,
                  }))
                }
              />
            </Field>
            <Field label="Preferred appointment" hint="Optional">
              <input
                className="ds-input"
                type="datetime-local"
                value={intake.preferredAppointmentAt ?? ""}
                onChange={(event) =>
                  setIntake((current) => ({ ...current, preferredAppointmentAt: event.target.value }))
                }
              />
            </Field>
            <Field label="Additional design preferences" hint="Optional" wide>
              <textarea
                className="ds-textarea"
                rows={3}
                value={intake.additionalPreferences ?? ""}
                onChange={(event) =>
                  setIntake((current) => ({ ...current, additionalPreferences: event.target.value }))
                }
              />
            </Field>
          </div>
          <button type="button" className="ds-btn ds-btn-primary lc-submit" disabled={generating} onClick={() => void generate()}>
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Generating lighting plan…
              </>
            ) : (
              "Generate lighting plan"
            )}
          </button>
        </section>

        <aside className="lc-sidebar">
          {rates ? (
            <section className="lc-card">
              <div className="lc-card-head">
                <h2>Provider rate table</h2>
                <p>Estimates use these rates. They are not live supplier prices.</p>
              </div>
              <dl className="lc-rates">
                <div>
                  <dt>Labour / hour</dt>
                  <dd>{formatInr(rates.labourPerHourInr)}</dd>
                </div>
                <div>
                  <dt>Ambient fixture</dt>
                  <dd>{formatInr(rates.ambientFixtureInr)}</dd>
                </div>
                <div>
                  <dt>Task fixture</dt>
                  <dd>{formatInr(rates.taskFixtureInr)}</dd>
                </div>
                <div>
                  <dt>Accent fixture</dt>
                  <dd>{formatInr(rates.accentFixtureInr)}</dd>
                </div>
                <div>
                  <dt>Travel</dt>
                  <dd>{formatInr(rates.travelInr)}</dd>
                </div>
              </dl>
            </section>
          ) : null}

          {job ? (
            <>
              <section className="lc-card">
                <div className="lc-card-head">
                  <h2>Lighting plan</h2>
                  <p>{job.plan.styleAndAmbience}</p>
                </div>
                <p className="lc-copy">
                  Colour temperature: {job.plan.colourTemperatureKelvin.range}.{" "}
                  {job.plan.colourTemperatureKelvin.explanation}
                </p>
                <ul className="lc-list">
                  {job.plan.layers.map((layer) => (
                    <li key={layer.name}>
                      <strong>{layer.name}:</strong> {layer.recommendation}
                    </li>
                  ))}
                </ul>
                <p className="lc-copy">{job.plan.energy}</p>
                <p className="lc-copy">Next step: {job.plan.nextStep.replace(/_/g, " ")}</p>
              </section>

              <section className="lc-card">
                <div className="lc-card-head">
                  <h2>Itemised estimate</h2>
                  <p>Not a binding quote until approvals and a site confirmation are complete.</p>
                </div>
                <ul className="lc-list">
                  {job.quote.lines.map((line) => (
                    <li key={line.id}>
                      {line.label}: {line.quantity} × {formatInr(line.unitInr)} = {formatInr(line.totalInr)}
                    </li>
                  ))}
                </ul>
                <p className="lc-total">
                  Estimated total: {formatInr(job.quote.totalInr)}
                  <span>{job.quote.status}</span>
                </p>
              </section>

              <section className="lc-card">
                <div className="lc-card-head">
                  <h2>Qloo insights</h2>
                </div>
                {job.qloo.source === "qloo" ? (
                  <>
                    <p className="lc-copy">
                      Returned from {job.qloo.endpoint} at {job.qloo.queriedAt}.
                    </p>
                    <ul className="lc-list">
                      {job.qloo.tags.map((tag) => (
                        <li key={tag.tagId}>Tag: {tag.name}</li>
                      ))}
                      {job.qloo.entities.map((entity) => (
                        <li key={entity.entityId}>Brand/entity: {entity.name}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="lc-copy">
                    Fallback recommendation. {job.qloo.error ?? "Qloo data was not used."} Kelvin and room
                    suitability still come from general lighting rules and the customer form.
                  </p>
                )}
              </section>

              <section className="lc-card">
                <div className="lc-card-head">
                  <h2>
                    <Shield className="h-4 w-4" /> Safety decision
                  </h2>
                </div>
                <p className="lc-copy">
                  {job.safety.decision} · {job.safety.actionType}
                </p>
                <p className="lc-copy">{job.safety.reason}</p>
                {job.safety.policyRules.length > 0 ? (
                  <p className="lc-copy">Policies: {job.safety.policyRules.join(", ")}</p>
                ) : null}
                <p className="lc-copy">
                  Approval: {job.safety.approvalStatus}. Execution: {job.safety.executionStatus}.
                </p>
                {job.safety.proposalId ? (
                  <Link href={`/approvals?proposal=${encodeURIComponent(job.safety.proposalId)}`} className="lc-link">
                    Open in Approvals
                  </Link>
                ) : null}
              </section>

              <section className="lc-card">
                <div className="lc-card-head">
                  <h2>Address verification</h2>
                  <p>
                    Status: {job.address.status.replaceAll("_", " ")}. Method: manual reviewer. A typed address is
                    not verification.
                  </p>
                </div>
                {job.address.note ? <p className="lc-copy">{job.address.note}</p> : null}
                {job.address.status === "missing" ? (
                  <p className="lc-copy">Add a service address in the intake, generate an updated plan, then request verification.</p>
                ) : null}
                {job.address.status !== "verified" ? (
                  <button
                    type="button"
                    className="ds-btn ds-btn-secondary"
                    disabled={working !== null || !job.intake.serviceAddress.trim()}
                    onClick={() => void postAction("verify-address", { jobId: job.id }, "verify")}
                  >
                    {working === "verify"
                      ? "Sending for review…"
                      : job.address.status === "pending_review"
                        ? "Verification already pending"
                        : "Request address verification"}
                  </button>
                ) : (
                  <p className="lc-copy">Verified by an authorised reviewer. WAVE did not auto-verify this address.</p>
                )}
              </section>

              <section className="lc-card">
                <div className="lc-card-head">
                  <h2>Electrician visit</h2>
                  <p>
                    Status: {job.appointment.status.replaceAll("_", " ")}. WAVE has no live electrician calendar, so
                    allowed requests stay pending confirmation — never booked.
                  </p>
                </div>
                {job.appointment.status === "pending_confirmation" ? (
                  <div className="lc-result">
                    <p className="lc-result-id">{job.appointment.requestId ?? `LC-VISIT-${job.id.slice(0, 8)}`}</p>
                    <ul className="lc-list">
                      {(job.appointment.outputLines && job.appointment.outputLines.length > 0
                        ? job.appointment.outputLines
                        : [
                            `Customer: ${job.intake.customerName}`,
                            `Contact: ${job.intake.contactPhone || job.intake.contactEmail || "not provided"}`,
                            `Address: ${job.address.address || job.intake.serviceAddress}`,
                            `Estimate: ${formatInr(job.quote.totalInr)}`,
                          ]
                      ).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    <p className="lc-copy">
                      This is a stored visit request for the electrician to confirm. It is not a booked timeslot.
                    </p>
                    {job.appointment.notificationId ? (
                      <Link href="/notifications" className="lc-link">
                        Open WAVE notification
                      </Link>
                    ) : (
                      <Link href="/notifications" className="lc-link">
                        Check WAVE notifications
                      </Link>
                    )}
                  </div>
                ) : (
                  <>
                    {job.appointment.note ? <p className="lc-copy">{job.appointment.note}</p> : null}
                    {job.address.status !== "verified" ? (
                      <p className="lc-copy">
                        Installation booking is blocked until a reviewer verifies the address. Requesting a visit now
                        will be evaluated by WAVE and will not create a booking.
                      </p>
                    ) : null}
                    <label className="lc-check">
                      <input
                        type="checkbox"
                        checked={confirmVisit}
                        onChange={(event) => setConfirmVisit(event.target.checked)}
                      />
                      I confirm the customer asked for this visit request.
                    </label>
                    <button
                      type="button"
                      className="ds-btn ds-btn-primary"
                      disabled={!confirmVisit || working !== null}
                      onClick={() =>
                        void postAction(
                          "request-visit",
                          {
                            jobId: job.id,
                            customerConfirmed: true,
                            preferredAppointmentAt: intake.preferredAppointmentAt,
                          },
                          "visit"
                        )
                      }
                    >
                      {working === "visit" ? "Submitting…" : "Request electrician visit"}
                    </button>
                  </>
                )}
              </section>
            </>
          ) : (
            <section className="lc-card lc-empty">
              <h2>No plan yet</h2>
              <p>Fill in the intake and generate a lighting plan. Quotes of ₹5,000 or more go through WAVE approvals.</p>
            </section>
          )}
        </aside>
      </div>
    </PageShell>
  );
}
