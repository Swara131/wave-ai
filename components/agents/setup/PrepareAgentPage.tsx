"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import type { AgentRequirement, AgentRequirementsResult } from "@/lib/agents/requirements/types";
import DataSourceSetupPanel from "@/components/agents/setup/DataSourceSetupPanel";

function isInteractive(item: AgentRequirement | undefined): item is AgentRequirement {
  return item != null && item.inputType !== "none" && item.status !== "unavailable";
}

export default function PrepareAgentPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
  const [result, setResult] = useState<AgentRequirementsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [deliveryTest, setDeliveryTest] = useState<Record<string, string>>({});
  const [deliveryBusy, setDeliveryBusy] = useState<string | null>(null);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!agentId) return null;
    if (!options?.silent) setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/agents/${encodeURIComponent(agentId)}/requirements?stage=setup`
      );
      const payload = (await response.json()) as AgentRequirementsResult & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not load requirements.");
      setResult(payload);
      const nextDrafts: Record<string, string> = {};
      for (const item of payload.requirements) {
        if (item.value) nextDrafts[item.key] = item.value;
      }
      setDrafts((current) => ({ ...nextDrafts, ...current }));
      return payload;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load requirements.");
      return null;
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (key: string, value: string) => {
    if (!agentId || !value.trim()) return;
    setSavingKey(key);
    setError(null);
    try {
      const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/requirements`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: value.trim() }),
      });
      const payload = (await response.json()) as AgentRequirementsResult & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not save.");
      setResult(payload);
      setDrafts((current) => ({ ...current, [key]: value.trim() }));
      setSavedKey(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSavingKey(null);
    }
  };

  const byKey = useMemo(() => {
    const map = new Map<string, AgentRequirement>();
    for (const item of result?.requirements ?? []) map.set(item.key, item);
    return map;
  }, [result]);

  const visibleSections = useMemo(() => {
    return (result?.sections ?? [])
      .map((section) => ({
        ...section,
        items: section.keys
          .map((key) => byKey.get(key))
          .filter(
            (item): item is AgentRequirement =>
              Boolean(item) &&
              isInteractive(item) &&
              item.key !== "ticket_source" &&
              item.key !== "data_source"
          ),
      }))
      .filter((section) => section.items.length > 0);
  }, [result, byKey]);

  const sectionStatus = (keys: string[]) => {
    const items = keys.map((key) => byKey.get(key)).filter(Boolean) as AgentRequirement[];
    const required = items.filter((item) => item.required);
    if (required.length === 0) return "optional";
    if (required.every((item) => item.status === "ready")) return "ready";
    if (required.some((item) => item.status === "ready")) return "partial";
    return "missing";
  };

  if (loading) {
    return (
      <PageShell maxWidth="4xl" className="prep-page">
        <p className="prep-loading">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading what this agent needs…
        </p>
      </PageShell>
    );
  }

  if (!result) {
    return (
      <PageShell maxWidth="4xl" className="prep-page">
        <p role="alert">{error ?? "Agent not found."}</p>
      </PageShell>
    );
  }

  return (
    <PageShell maxWidth="4xl" className="prep-page">
      <header className="prep-header">
        <p className="prep-kicker">Prepare your agent</p>
        <h1>Let&apos;s provide the information your {result.agentName} needs before we run a test.</h1>
        <p className="prep-agent">
          Wave is asking only for what this agent needs to do its job — not a generic technical checklist.
        </p>
      </header>

      <section className="prep-progress" aria-label="Setup progress">
        <p>
          Progress: {result.readyCount} of {result.requiredCount} completed
        </p>
        <div className="prep-progress-bar">
          <span
            style={{
              width: `${result.requiredCount ? (result.readyCount / result.requiredCount) * 100 : 0}%`,
            }}
          />
        </div>
        <ol className="prep-section-status">
          {visibleSections.map((section) => {
            const status = sectionStatus(section.keys);
            return (
              <li key={section.id} className={`is-${status}`}>
                {status === "ready" ? "✓" : status === "partial" ? "⚠" : "○"} {section.title}
                <small>
                  {status === "ready" ? "Completed" : status === "partial" ? "Complete" : "Needed"}
                </small>
              </li>
            );
          })}
        </ol>
      </section>

      {error ? (
        <p className="prep-error" role="alert">
          {error}
        </p>
      ) : null}

      {byKey.has("ticket_source") || byKey.has("data_source") || byKey.has("database") ? (
        <DataSourceSetupPanel agentId={agentId} onStatusChange={() => void load({ silent: true })} />
      ) : null}

      {visibleSections.map((section) => (
        <section key={section.id} className="prep-section">
          <header>
            <h2>{section.title}</h2>
            {section.description ? <p>{section.description}</p> : null}
          </header>
          <div className="prep-cards">
            {section.items.map((item) => (
              <RequirementCard
                key={item.key}
                item={item}
                draft={
                  item.key === "contact_company" && !drafts.contact_company && drafts.company_name
                    ? drafts.company_name
                    : (drafts[item.key] ?? item.value ?? "")
                }
                saving={savingKey === item.key}
                saved={savedKey === item.key && savingKey !== item.key}
                deliveryStatus={deliveryTest[item.key]}
                deliveryBusy={deliveryBusy === item.key}
                onDraft={(value) => setDrafts((current) => ({ ...current, [item.key]: value }))}
                onSave={(value) => void save(item.key, value)}
                onTestDelivery={
                  item.configurationType === "email" || item.configurationType === "phone"
                    ? () =>
                        void (async () => {
                          setDeliveryBusy(item.key);
                          setDeliveryTest((current) => ({ ...current, [item.key]: "" }));
                          try {
                            const path =
                              item.configurationType === "email"
                                ? `/api/v1/agents/${encodeURIComponent(agentId)}/platform/test-email`
                                : `/api/v1/agents/${encodeURIComponent(agentId)}/platform/test-whatsapp`;
                            const response = await fetch(path, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify(
                                item.configurationType === "email"
                                  ? { to: drafts[item.key] || item.value }
                                  : { recipientPhone: drafts[item.key] || item.value }
                              ),
                            });
                            const payload = (await response.json()) as {
                              success?: boolean;
                              error?: string;
                              messageId?: string;
                              to?: string;
                              sentAt?: string;
                              fix?: string;
                            };
                            if (!response.ok || !payload.success) {
                              setDeliveryTest((current) => ({
                                ...current,
                                [item.key]: `✕ ${payload.error ?? "Delivery failed."}${
                                  payload.fix ? ` ${payload.fix}` : ""
                                }`,
                              }));
                              return;
                            }
                            setDeliveryTest((current) => ({
                              ...current,
                              [item.key]: `✓ Test sent${payload.messageId ? ` · ${payload.messageId}` : ""}${
                                payload.sentAt ? ` · ${new Date(payload.sentAt).toLocaleTimeString()}` : ""
                              }`,
                            }));
                          } catch (err) {
                            setDeliveryTest((current) => ({
                              ...current,
                              [item.key]:
                                err instanceof Error ? `✕ ${err.message}` : "✕ Delivery failed.",
                            }));
                          } finally {
                            setDeliveryBusy(null);
                          }
                        })()
                    : undefined
                }
              />
            ))}
          </div>
        </section>
      ))}

      {result.testScenario.length > 0 ? (
        <section className="prep-scenario">
          <h2>Test scenario</h2>
          <p>This is the information that will be used for the first test.</p>
          <dl>
            {result.testScenario.map((line) => (
              <div key={`${line.label}-${line.value}`}>
                <dt>{line.label}</dt>
                <dd>{line.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {result.ready ? (
        <section className="prep-review" id="ready-to-test">
          <h2>Ready to test</h2>
          <p>{result.agentName}</p>
          <ul>
            {visibleSections.map((section) => (
              <li key={section.id}>
                <Check className="h-4 w-4" strokeWidth={2.5} />
                <span>{section.title}</span>
                <small>Configured</small>
              </li>
            ))}
          </ul>
          {result.testScenario.length > 0 ? (
            <p className="prep-hint">
              Test data: {result.testScenario.map((line) => line.value).join(" · ")}
            </p>
          ) : null}
          <button
            type="button"
            className="prep-btn prep-btn-primary"
            onClick={() => router.push(`/agents/${encodeURIComponent(agentId)}/test`)}
          >
            Test Agent
          </button>
        </section>
      ) : (
        <div className="prep-actions">
          <p className="prep-hint">Finish the required items above so the first test has real information to use.</p>
          <button
            type="button"
            className="prep-btn prep-btn-secondary"
            onClick={() =>
              void (async () => {
                const next = await load({ silent: true });
                if (next?.ready) {
                  router.push(`/agents/${encodeURIComponent(agentId)}/test`);
                  return;
                }
                setReviewOpen(true);
              })()
            }
          >
            Review & Continue
          </button>
          {reviewOpen ? (
            <ul className="prep-ready-list">
              {result.missing.map((item) => (
                <li key={item.key}>
                  <span className="prep-dot" />
                  {item.label}
                  {item.key === "data_source" ? (
                    <small className="prep-fail-reason">
                      Upload a CSV (or another source), map columns, then Save and verify. This
                      is not a setting you select here.
                    </small>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </PageShell>
  );
}

function RequirementCard({
  item,
  draft,
  saving,
  saved,
  deliveryStatus,
  deliveryBusy,
  onDraft,
  onSave,
  onTestDelivery,
}: {
  item: AgentRequirement;
  draft: string;
  saving: boolean;
  saved?: boolean;
  deliveryStatus?: string;
  deliveryBusy?: boolean;
  onDraft: (value: string) => void;
  onSave: (value: string) => void;
  onTestDelivery?: () => void;
}) {
  const done = item.status === "ready";
  const options = item.options ?? [];
  const type = item.inputType || item.configurationType;
  const selected = new Set(draft.split(",").filter(Boolean));

  return (
    <article className={`prep-card ${done ? "is-ready" : ""}`}>
      <header>
        <div>
          <h3>
            {item.label}
            {item.required ? <span className="prep-required"> *</span> : null}
          </h3>
          <p>{item.reason}</p>
        </div>
        {saved ? <span className="prep-ready">✓ Saved</span> : done ? <span className="prep-ready">Configured</span> : null}
      </header>

      {type === "choice" || type === "radio" || type === "policy" || type === "select" ? (
        <div className="prep-options">
          {options.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className={`prep-chip ${draft === choice.id ? "is-selected" : ""}`}
              disabled={saving}
              onClick={() => onSave(choice.id)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      ) : null}

      {type === "checkbox" ? (
        <div className="prep-options">
          {options.map((choice) => {
            const on = selected.has(choice.id);
            return (
              <button
                key={choice.id}
                type="button"
                className={`prep-chip ${on ? "is-selected" : ""}`}
                disabled={saving}
                onClick={() => {
                  const next = new Set(selected);
                  if (on) next.delete(choice.id);
                  else next.add(choice.id);
                  onSave([...next].join(","));
                }}
              >
                {on ? "☑" : "☐"} {choice.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {type === "email" ||
      type === "phone" ||
      type === "url" ||
      type === "text" ||
      type === "textarea" ||
      type === "date" ||
      type === "time" ||
      type === "timezone" ? (
        <form
          className="prep-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSave(draft);
          }}
        >
          {type === "textarea" ? (
            <textarea
              className="ds-input"
              rows={4}
              value={draft}
              placeholder={item.placeholder}
              onChange={(event) => onDraft(event.target.value)}
            />
          ) : (
            <input
              className="ds-input"
              type={
                type === "email"
                  ? "email"
                  : type === "url"
                    ? "url"
                    : type === "phone"
                      ? "tel"
                      : type === "date"
                        ? "date"
                        : type === "time"
                          ? "time"
                          : "text"
              }
              value={draft}
              placeholder={item.placeholder}
              onChange={(event) => onDraft(event.target.value)}
            />
          )}
          <button type="submit" className="prep-btn prep-btn-secondary" disabled={saving || !draft.trim()}>
            {saving ? "Saving…" : "Save"}
          </button>
          {onTestDelivery ? (
            <button
              type="button"
              className="prep-btn prep-btn-secondary"
              disabled={deliveryBusy || !draft.trim()}
              onClick={onTestDelivery}
            >
              {deliveryBusy
                ? "Sending…"
                : item.configurationType === "email"
                  ? "Send test email"
                  : "Send test WhatsApp"}
            </button>
          ) : null}
        </form>
      ) : null}
      {deliveryStatus ? <p className="prep-hint">{deliveryStatus}</p> : null}

      {type === "schedule" ? <ScheduleFields draft={draft} saving={saving} onSave={onSave} /> : null}

      {type === "connection" && item.actionHref ? (
        <Link href={item.actionHref} className="prep-btn prep-btn-secondary">
          {item.action ?? "Open"}
        </Link>
      ) : null}

      {item.key === "crm" ? (
        <p className="prep-hint">Connect CRM only if company or contact data should come from CRM — not if you entered it here.</p>
      ) : null}

      {item.status === "unavailable" ? <p className="prep-unavailable">{item.description}</p> : null}
    </article>
  );
}

function ScheduleFields({
  draft,
  saving,
  onSave,
}: {
  draft: string;
  saving: boolean;
  onSave: (value: string) => void;
}) {
  let when = "daily";
  let time = "09:00";
  let timezone = "Asia/Kolkata";
  try {
    const parsed = JSON.parse(draft) as { when?: string; time?: string; timezone?: string };
    when = parsed.when ?? when;
    time = parsed.time ?? time;
    timezone = parsed.timezone ?? timezone;
  } catch {
    const parts = draft.split("|");
    if (parts[0]) when = parts[0];
    if (parts[1]) time = parts[1];
    if (parts[2]) timezone = parts[2];
  }

  return (
    <form
      className="prep-form prep-schedule"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSave(
          JSON.stringify({
            when: String(data.get("when") ?? "daily"),
            time: String(data.get("time") ?? "09:00"),
            timezone: String(data.get("timezone") ?? "Asia/Kolkata"),
          })
        );
      }}
    >
      <select className="ds-input" name="when" defaultValue={when}>
        <option value="daily">Every morning / daily</option>
        <option value="weekly">Weekly</option>
        <option value="at_time">At a specific time</option>
      </select>
      <input className="ds-input" name="time" type="time" defaultValue={time} />
      <input className="ds-input" name="timezone" defaultValue={timezone} aria-label="Timezone" />
      <button type="submit" className="prep-btn prep-btn-secondary" disabled={saving}>
        {saving ? "Saving…" : "Save schedule"}
      </button>
    </form>
  );
}
