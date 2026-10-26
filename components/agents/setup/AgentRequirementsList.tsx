"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, Check, Circle, AlertTriangle } from "lucide-react";
import type { AgentRequirement, AgentRequirementsResult } from "@/lib/agents/requirements/types";

interface AgentRequirementsListProps {
  result: AgentRequirementsResult;
  saving?: boolean;
  error?: string | null;
  onConfigure?: (requirement: AgentRequirement, value?: string) => void;
  testHref?: string;
}

export default function AgentRequirementsList({
  result,
  saving,
  error,
  onConfigure,
  testHref,
}: AgentRequirementsListProps) {
  const [emailDraft, setEmailDraft] = useState("");
  const [phoneDraft, setPhoneDraft] = useState("");
  const [timeDraft, setTimeDraft] = useState("09:00");
  const [timezoneDraft, setTimezoneDraft] = useState("Asia/Kolkata");

  useEffect(() => {
    setEmailDraft("");
    setPhoneDraft("");
  }, [result.agentId]);

  const progressPct =
    result.requiredCount > 0
      ? Math.round((result.readyCount / result.requiredCount) * 100)
      : 0;

  return (
    <section className="asp-card asp-checklist" aria-labelledby="asp-req-heading">
      <h2 id="asp-req-heading" className="asp-card-title">
        Let&apos;s prepare your agent
      </h2>
      <p className="asp-checklist-lead">{result.agentName} needs:</p>
      <ol className="asp-checklist-list">
        {result.requirements
          .filter((item) => (item.scope ?? "setup") === "setup")
          .map((item) => {
          const done = item.status === "ready";
          const isNotify = item.key === "wave_notify";
          return (
            <li
              key={item.key}
              className={`asp-checklist-item ${done ? "asp-checklist-item-done" : "asp-checklist-item-pending"} ${isNotify ? "asp-checklist-item-notify" : ""}`}
            >
              <span className="asp-checklist-marker" aria-hidden="true">
                {done && isNotify ? (
                  <Bell className="asp-checklist-check" strokeWidth={2.25} />
                ) : done ? (
                  <Check className="asp-checklist-check" strokeWidth={2.5} />
                ) : (
                  <AlertTriangle className="h-4 w-4" strokeWidth={2} />
                )}
              </span>
              <div className="asp-checklist-body">
                <p className="asp-checklist-step-title">{item.label}</p>
                <p className="asp-checklist-step-sub">{item.reason}</p>
                {!done && item.configurationType === "email" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input
                      type="email"
                      className="ds-input"
                      placeholder="you@example.com"
                      value={emailDraft}
                      onChange={(event) => setEmailDraft(event.target.value)}
                    />
                    <button
                      type="button"
                      className="asp-checklist-btn"
                      disabled={saving}
                      onClick={() => onConfigure?.(item, emailDraft)}
                    >
                      Save recipient
                    </button>
                  </div>
                ) : null}
                {!done && item.configurationType === "phone" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input
                      type="tel"
                      className="ds-input"
                      placeholder="+91…"
                      value={phoneDraft}
                      onChange={(event) => setPhoneDraft(event.target.value)}
                    />
                    <button
                      type="button"
                      className="asp-checklist-btn"
                      disabled={saving}
                      onClick={() => onConfigure?.(item, phoneDraft)}
                    >
                      Save number
                    </button>
                  </div>
                ) : null}
                {!done && item.configurationType === "schedule" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <select
                      className="ds-input"
                      defaultValue="daily"
                      onChange={(event) => event.currentTarget.dataset.when = event.target.value}
                      id={`schedule-when-${item.key}`}
                    >
                      <option value="daily">Every morning / daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="at_time">At a specific time</option>
                    </select>
                    <input
                      type="time"
                      className="ds-input"
                      value={timeDraft}
                      onChange={(event) => setTimeDraft(event.target.value)}
                    />
                    <input
                      className="ds-input"
                      value={timezoneDraft}
                      onChange={(event) => setTimezoneDraft(event.target.value)}
                      aria-label="Timezone"
                    />
                    <button
                      type="button"
                      className="asp-checklist-btn"
                      disabled={saving}
                      onClick={() => {
                        const when =
                          (document.getElementById(`schedule-when-${item.key}`) as HTMLSelectElement)
                            ?.value ?? "daily";
                        onConfigure?.(item, JSON.stringify({ when, time: timeDraft, timezone: timezoneDraft }));
                      }}
                    >
                      Save schedule
                    </button>
                  </div>
                ) : null}
                {!done && item.configurationType === "choice" && item.options ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.options.map((choice) => (
                      <button
                        key={choice.id}
                        type="button"
                        className="asp-checklist-btn"
                        disabled={saving}
                        onClick={() => onConfigure?.(item, choice.id)}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {!done && item.actionHref && item.configurationType !== "email" && item.configurationType !== "phone" && item.configurationType !== "schedule" && item.configurationType !== "choice" ? (
                  <Link href={item.actionHref} className="asp-checklist-btn">
                    {item.action ?? "Configure"}
                  </Link>
                ) : null}
                {done ? (
                  <span className="asp-checklist-done-badge">
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                    Ready
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="asp-progress" aria-label={`${result.readyCount} of ${result.requiredCount} ready`}>
        <div className="asp-progress-track">
          <span style={{ width: `${progressPct}%` }} />
        </div>
        <p className="asp-progress-label">
          {result.readyCount} / {result.requiredCount} ready
        </p>
      </div>
      {error ? (
        <p className="ag-error" role="alert">
          {error}
        </p>
      ) : null}
      {result.ready ? (
        <p className="asp-complete-lead">
          Your {result.agentName} is ready to test.
          {testHref ? (
            <Link href={testHref} className="asp-checklist-btn">
              Run Test
            </Link>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

export function MissingRequirementsBanner({
  missing,
}: {
  missing: AgentRequirement[];
}) {
  if (missing.length === 0) return null;
  return (
    <section className="ds-panel" role="alert">
      <h2>Your agent isn&apos;t ready to test yet.</h2>
      <ul className="asp-checklist-list">
        {missing.map((item) => (
          <li key={item.key} className="asp-checklist-item asp-checklist-item-pending">
            <Circle className="asp-checklist-circle" strokeWidth={2} />
            <div>
              <p className="asp-checklist-step-title">{item.label}</p>
              <p className="asp-checklist-step-sub">{item.reason}</p>
              {item.actionHref ? (
                <Link href={item.actionHref} className="asp-checklist-btn">
                  {item.action ?? "Configure"}
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
