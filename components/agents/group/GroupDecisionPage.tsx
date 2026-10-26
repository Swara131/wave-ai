"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import ErrorState from "@/components/ui/ErrorState";
import StatusBadge from "@/components/ui/StatusBadge";
import { FEEDBACK_REASONS, SAMPLE_GROUP_INTAKE, SCORE_WEIGHTS } from "@/lib/group-planner/constants";
import { groupFieldErrors, groupIntakeSchema } from "@/lib/group-planner/intake";
import type { FeedbackReason } from "@/lib/group-planner/constants";
import type { GroupOuting, GroupParticipant } from "@/lib/group-planner/types";

const STEPS = [
  { id: "group", label: "Group" },
  { id: "people", label: "People" },
  { id: "discover", label: "Discover" },
  { id: "picks", label: "Picks" },
  { id: "plan", label: "Plan" },
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

function blankPerson(): GroupParticipant {
  return {
    id: `person-${Math.random().toString(36).slice(2, 8)}`,
    displayName: "",
    likes: ["", "", ""],
  };
}

function fromSample(): GroupParticipant[] {
  return SAMPLE_GROUP_INTAKE.participants.map((person, index) => ({
    id: `person-${index + 1}`,
    displayName: person.displayName,
    likes: person.likes,
    preferredCuisines: person.preferredCuisines,
    dietary: person.dietary || undefined,
    neighborhood: person.neighborhood,
  }));
}

export default function GroupDecisionPage() {
  const params = useParams();
  const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
  const [step, setStep] = useState(0);
  const [agentName, setAgentName] = useState("Group Decision Planner");
  const [agentStatus, setAgentStatus] = useState("draft");
  const [threshold, setThreshold] = useState(5000);
  const [outing, setOuting] = useState<GroupOuting | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [groupName, setGroupName] = useState(SAMPLE_GROUP_INTAKE.groupName);
  const [city, setCity] = useState(SAMPLE_GROUP_INTAKE.city);
  const [outingDate, setOutingDate] = useState(SAMPLE_GROUP_INTAKE.outingDate);
  const [startTime, setStartTime] = useState(SAMPLE_GROUP_INTAKE.startTime);
  const [endTime, setEndTime] = useState(SAMPLE_GROUP_INTAKE.endTime);
  const [maxBudgetInr, setMaxBudgetInr] = useState(SAMPLE_GROUP_INTAKE.maxBudgetInr);
  const [maxTravelMinutes, setMaxTravelMinutes] = useState(SAMPLE_GROUP_INTAKE.maxTravelMinutes);
  const [people, setPeople] = useState<GroupParticipant[]>(fromSample());
  const [feedbackReason, setFeedbackReason] = useState<FeedbackReason>("food");
  const [feedbackPerson, setFeedbackPerson] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/group`);
      const payload = (await response.json()) as {
        agentName?: string;
        status?: string;
        reservationThresholdInr?: number;
        outing?: GroupOuting | null;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Could not load Group Decision Planner.");
      setAgentName(payload.agentName ?? "Group Decision Planner");
      setAgentStatus(payload.status ?? "draft");
      setThreshold(payload.reservationThresholdInr ?? 5000);
      if (payload.outing) {
        setOuting(payload.outing);
        setGroupName(payload.outing.intake.groupName);
        setCity(payload.outing.intake.city);
        setOutingDate(payload.outing.intake.outingDate);
        setStartTime(payload.outing.intake.startTime);
        setEndTime(payload.outing.intake.endTime ?? "");
        setMaxBudgetInr(payload.outing.intake.maxBudgetInr);
        setMaxTravelMinutes(payload.outing.intake.maxTravelMinutes);
        setPeople(payload.outing.intake.participants);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Group Decision Planner.");
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
      signal: AbortSignal.timeout(60_000),
    });
    const payload = (await response.json()) as { outing?: GroupOuting; error?: string; reservationThresholdInr?: number };
    if (!response.ok) throw new Error(payload.error ?? "Request failed.");
    if (payload.outing) setOuting(payload.outing);
    if (payload.reservationThresholdInr) setThreshold(payload.reservationThresholdInr);
    return payload;
  };

  const saveGroup = async (saveDraft: boolean) => {
    const parsed = groupIntakeSchema.safeParse({
      groupName,
      city,
      outingDate,
      startTime,
      endTime,
      maxBudgetInr,
      budgetCurrency: "INR",
      maxTravelMinutes,
      participants: people.map((person) => ({
        ...person,
        likes: person.likes.map((like) => like.trim()).filter(Boolean),
      })),
      isDraft: saveDraft,
    });
    if (!parsed.success) {
      setFieldErrors(groupFieldErrors(parsed.error));
      throw new Error(parsed.error.issues[0]?.message ?? "Check the group form.");
    }
    setFieldErrors({});
    const payload = await postJson("group", { ...parsed.data, outingId: outing?.id, saveDraft });
    return payload.outing ?? null;
  };

  const goNext = async () => {
    setWorking("next");
    setError(null);
    try {
      if (step === 0 || step === 1) {
        await saveGroup(step === 0);
        setStep(step + 1);
        return;
      }
      if (step === 2) {
        if (!outing) throw new Error("Save the group first.");
        setNotice("Asking Qloo for place candidates…");
        await postJson("group/action", { action: "discover", outingId: outing.id });
        setStep(3);
        return;
      }
      if (step === 4) {
        setStep(5);
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

  return (
    <PageShell maxWidth="4xl" className="lc-page">
      <header className="lc-header">
        <div>
          <Link href={`/agents/${encodeURIComponent(agentId)}`} className="lc-back">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Agent
          </Link>
          <p className="lc-kicker">Group Decision Planner</p>
          <h1>{agentName}</h1>
          <p className="lc-lead">Each person’s tastes stay separate. Next saves the step. Qloo is used only on Discover.</p>
        </div>
        <StatusBadge tone={agentStatus === "active" || agentStatus === "published" ? "success" : "warning"}>
          {agentStatus}
        </StatusBadge>
      </header>

      <ol className="lc-wizard-progress">
        {STEPS.map((item, index) => (
          <li key={item.id} className={index === step ? "is-current" : index < step ? "is-done" : undefined}>
            {index + 1}. {item.label}
          </li>
        ))}
      </ol>

      {loading ? (
        <p className="lc-loading">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading saved group…
        </p>
      ) : null}
      {error ? <ErrorState title="Group Decision Planner" description={error} onFix={() => void load()} /> : null}
      {notice && step !== 5 ? <Banner tone="ok" title="Saved">{notice}</Banner> : null}

      {current?.id === "group" ? (
        <section className="lc-card">
          <div className="lc-card-head">
            <h2>Group details</h2>
          </div>
          <div className="lc-fields">
            <Field label="Group name" error={fieldErrors.groupName}>
              <input className="ds-input" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
            </Field>
            <Field label="City" error={fieldErrors.city}>
              <input className="ds-input" value={city} onChange={(e) => setCity(e.target.value)} />
            </Field>
            <Field label="Outing date" error={fieldErrors.outingDate}>
              <input className="ds-input" type="date" value={outingDate} onChange={(e) => setOutingDate(e.target.value)} />
            </Field>
            <Field label="Start time" error={fieldErrors.startTime}>
              <input className="ds-input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field label="End time">
              <input className="ds-input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
            <Field label="Maximum total budget (INR)" error={fieldErrors.maxBudgetInr}>
              <input className="ds-input" type="number" min={500} value={maxBudgetInr} onChange={(e) => setMaxBudgetInr(Number(e.target.value))} />
            </Field>
            <Field label="Maximum travel time (minutes)" error={fieldErrors.maxTravelMinutes}>
              <input className="ds-input" type="number" min={5} value={maxTravelMinutes} onChange={(e) => setMaxTravelMinutes(Number(e.target.value))} />
            </Field>
          </div>
        </section>
      ) : null}

      {current?.id === "people" ? (
        <section className="lc-card">
          <div className="lc-card-head">
            <h2>Participants</h2>
            <p>Do not copy the organizer’s tastes onto everyone. Each card is stored separately.</p>
          </div>
          {people.map((person, index) => (
            <div key={person.id} className="lc-card" style={{ marginTop: "0.75rem" }}>
              <div className="lc-fields">
                <Field label="Display name">
                  <input className="ds-input" value={person.displayName} onChange={(e) => setPeople((list) => list.map((item, i) => (i === index ? { ...item, displayName: e.target.value } : item)))} />
                </Field>
                <Field label="Neighborhood">
                  <input className="ds-input" value={person.neighborhood ?? ""} onChange={(e) => setPeople((list) => list.map((item, i) => (i === index ? { ...item, neighborhood: e.target.value } : item)))} />
                </Field>
                <Field label="Three or more likes" wide>
                  <input
                    className="ds-input"
                    value={person.likes.join(", ")}
                    onChange={(e) =>
                      setPeople((list) =>
                        list.map((item, i) => (i === index ? { ...item, likes: e.target.value.split(",").map((part) => part.trim()).filter(Boolean) } : item))
                      )
                    }
                  />
                </Field>
                <Field label="Preferred cuisines">
                  <input className="ds-input" value={person.preferredCuisines ?? ""} onChange={(e) => setPeople((list) => list.map((item, i) => (i === index ? { ...item, preferredCuisines: e.target.value } : item)))} />
                </Field>
                <Field label="Dietary restrictions">
                  <input className="ds-input" value={person.dietary ?? ""} onChange={(e) => setPeople((list) => list.map((item, i) => (i === index ? { ...item, dietary: e.target.value } : item)))} />
                </Field>
                <Field label="Dislikes">
                  <input className="ds-input" value={person.dislikes ?? ""} onChange={(e) => setPeople((list) => list.map((item, i) => (i === index ? { ...item, dislikes: e.target.value } : item)))} />
                </Field>
              </div>
              {people.length > 2 ? (
                <button type="button" className="ds-btn ds-btn-sm ds-btn-secondary" onClick={() => setPeople((list) => list.filter((_, i) => i !== index))}>
                  Remove
                </button>
              ) : null}
            </div>
          ))}
          <div className="tc-actions">
            <button type="button" className="ds-btn ds-btn-secondary" onClick={() => setPeople((list) => [...list, blankPerson()])}>
              Add participant
            </button>
            <button type="button" className="ds-btn ds-btn-secondary" onClick={() => setPeople(fromSample())}>
              Load sample four friends
            </button>
          </div>
        </section>
      ) : null}

      {current?.id === "discover" ? (
        <section className="lc-card">
          <div className="lc-card-head">
            <h2>Discover restaurants</h2>
            <p>
              Next calls Qloo place insights for {city}. WAVE will not invent restaurants. Scoring weights: taste {SCORE_WEIGHTS.taste}, budget {SCORE_WEIGHTS.budget}, travel {SCORE_WEIGHTS.travel}, diet {SCORE_WEIGHTS.diet}, fairness {SCORE_WEIGHTS.fairness}.
            </p>
          </div>
          {outing?.qloo.error ? (
            <Banner tone="warn" title="Qloo fallback">
              {outing.qloo.error} Results below are not claimed as live Qloo restaurants.
            </Banner>
          ) : (
            <p className="lc-copy">{people.length} individual profiles will be sent as signals. No places provider is connected, so hours, prices, and travel times stay unknown unless Qloo returns them.</p>
          )}
        </section>
      ) : null}

      {current?.id === "picks" ? (
        <section className="lc-card">
          <div className="lc-card-head">
            <h2>Three recommendation types</h2>
            <p>Source and uncertainty are labelled. Not for me re-ranks on the server.</p>
          </div>
          {outing?.tooFewReason ? <Banner tone="warn" title="Fewer than three options">{outing.tooFewReason}</Banner> : null}
          {outing?.recommendations.length ? (
            outing.recommendations.map((item) => (
              <div key={item.kind} className="lc-card" style={{ marginTop: "0.75rem" }}>
                <h3>{item.title}</h3>
                <p className="lc-copy">
                  <strong>{item.scored.candidate.name}</strong> · {item.scored.candidate.cuisine ?? "cuisine unknown"} · {item.scored.candidate.address ?? item.scored.candidate.neighborhood ?? "address unknown"} · source {item.scored.candidate.source} · retrieved {item.scored.candidate.retrievedAt}
                </p>
                <p className="lc-copy">{item.scored.explanation}</p>
                <p className="lc-copy">{item.scored.tradeoffs}</p>
                <ul className="lc-list">
                  {item.scored.matches.map((match) => (
                    <li key={match.participantId}>
                      {match.displayName}: {match.qualitative} ({match.score}) — {match.explanation}
                    </li>
                  ))}
                </ul>
                <p className="lc-copy">Weakest match: {item.scored.weakest.displayName}. Reservation: unverified. Hours: {item.scored.candidate.openingHours ?? "unknown"}.</p>
                {rejectingId === item.scored.candidate.id ? (
                  <div className="tc-actions">
                    <select className="ds-select" value={feedbackPerson} onChange={(e) => setFeedbackPerson(e.target.value)}>
                      <option value="">Whose veto?</option>
                      {people.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.displayName}
                        </option>
                      ))}
                    </select>
                    <select className="ds-select" value={feedbackReason} onChange={(e) => setFeedbackReason(e.target.value as FeedbackReason)}>
                      {FEEDBACK_REASONS.map((reason) => (
                        <option key={reason} value={reason}>
                          {reason}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="ds-btn ds-btn-primary"
                      disabled={busy || !feedbackPerson || !outing}
                      onClick={async () => {
                        setWorking("feedback");
                        try {
                          await postJson("group/action", {
                            action: "feedback",
                            outingId: outing.id,
                            participantId: feedbackPerson,
                            restaurantId: item.scored.candidate.id,
                            reason: feedbackReason,
                          });
                          setRejectingId(null);
                          setNotice("Rankings were recomputed from persisted feedback.");
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Feedback failed.");
                        } finally {
                          setWorking(null);
                        }
                      }}
                    >
                      Save veto and re-rank
                    </button>
                  </div>
                ) : (
                  <div className="tc-actions">
                    <button type="button" className="ds-btn ds-btn-secondary" onClick={() => setRejectingId(item.scored.candidate.id)}>
                      Not for me
                    </button>
                    <button
                      type="button"
                      className="ds-btn ds-btn-primary"
                      disabled={busy || !outing}
                      onClick={async () => {
                        setWorking("select");
                        try {
                          await postJson("group/action", { action: "select", outingId: outing.id, restaurantId: item.scored.candidate.id });
                          setStep(4);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Could not select restaurant.");
                        } finally {
                          setWorking(null);
                        }
                      }}
                    >
                      Choose this restaurant
                    </button>
                  </div>
                )}
              </div>
            ))
          ) : (
            <p className="lc-copy">No live restaurant list yet. Go back and run Discover, or check the Qloo error.</p>
          )}
          {outing?.feedback.filter((item) => !item.undone).map((item) => (
            <p key={item.id} className="lc-copy">
              History: {item.restaurantName} rejected for {item.reason}.
              <button
                type="button"
                className="ds-btn ds-btn-sm ds-btn-secondary"
                onClick={() => void postJson("group/action", { action: "undo", outingId: outing.id, feedbackId: item.id })}
              >
                Undo
              </button>
            </p>
          ))}
        </section>
      ) : null}

      {current?.id === "plan" ? (
        <section className="lc-card">
          <div className="lc-card-head">
            <h2>Outing plan</h2>
          </div>
          {outing?.itinerary ? (
            <>
              <p className="lc-copy">
                {outing.itinerary.restaurantName} on {outing.itinerary.date} at {outing.itinerary.startTime}. Meet near {outing.itinerary.meetingArea}. Cost per person: {outing.itinerary.costPerPerson == null ? "unknown" : `₹${outing.itinerary.costPerPerson}`}. Reservation: {outing.itinerary.reservationStatus}.
              </p>
              <p className="lc-copy">Unresolved: {outing.itinerary.unresolved.join("; ")}</p>
              <p className="lc-copy">Paid booking threshold: ₹{threshold.toLocaleString("en-IN")}. No booking provider is connected.</p>
              <button
                type="button"
                className="ds-btn ds-btn-primary"
                disabled={busy}
                onClick={async () => {
                  setWorking("reserve");
                  try {
                    await postJson("group/action", { action: "reserve", outingId: outing.id, confirmedReview: true });
                    setNotice("Pending confirmation stored. WAVE did not reserve a table.");
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Reservation request failed.");
                  } finally {
                    setWorking(null);
                  }
                }}
              >
                Request pending reservation
              </button>
              {outing.reservation ? <p className="lc-copy">{outing.reservation.status} · {outing.reservation.note}</p> : null}
              {outing.safety ? <p className="lc-copy">Safety: {outing.safety.decision} · {outing.safety.reason}</p> : null}
            </>
          ) : (
            <p className="lc-copy">Choose a restaurant on the previous step to build the plan.</p>
          )}
        </section>
      ) : null}

      {current?.id === "done" ? (
        <section className="lc-card lc-success">
          <CheckCircle2 className="lc-success-icon" aria-hidden="true" />
          <h2>Group plan saved</h2>
          <p className="lc-lead">
            {outing?.intake.groupName ?? "Your group"} is stored on this WAVE agent. {outing?.qloo.source === "qloo" ? "Restaurant candidates came from Qloo." : "Qloo was not used as a live source for the final list."} No table is confirmed.
          </p>
          <div className="lc-wizard-nav">
            <button type="button" className="ds-btn ds-btn-secondary" onClick={() => setStep(0)}>
              Edit group
            </button>
            <Link href={`/agents/${encodeURIComponent(agentId)}`} className="ds-btn ds-btn-primary">
              Back to agent
            </Link>
          </div>
        </section>
      ) : null}

      {step < STEPS.length - 1 ? (
        <div className="lc-wizard-nav">
          {step > 0 ? (
            <button type="button" className="ds-btn ds-btn-secondary" disabled={busy} onClick={() => setStep((current) => current - 1)}>
              Back
            </button>
          ) : null}
          <button type="button" className="ds-btn ds-btn-primary" disabled={busy || loading} onClick={() => void goNext()}>
            {working === "next" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {step === 2 ? "Discover restaurants" : step === 4 ? "Finish" : "Next"}
          </button>
        </div>
      ) : null}
    </PageShell>
  );
}
