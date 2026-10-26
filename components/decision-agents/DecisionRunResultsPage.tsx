"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, Loader2 } from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import { sourceKindLabel } from "@/lib/decision-agents/execution-agents";
import type { DecisionAgentRunRecord } from "@/lib/decision-agents/run-types";

function statusClass(status: string): string {
  if (status === "completed") return "is-done";
  if (status === "running" || status === "pending") return "is-run";
  if (status === "failed") return "is-fail";
  return "is-wait";
}

function statusLabel(status: string): string {
  if (status === "completed") return "Completed";
  if (status === "running") return "Running";
  if (status === "pending") return "Waiting";
  if (status === "failed") return "Failed";
  if (status === "unable_to_verify") return "Unable to verify";
  return status;
}

export default function DecisionRunResultsPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const runId = typeof params.runId === "string" ? params.runId.trim() : "";
  const from = searchParams.get("from") || "/decision-agents/create";
  const retryingLock = useRef(false);
  const [run, setRun] = useState<DecisionAgentRunRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    if (!runId) return;
    const response = await fetch(`/api/v1/decision-agents/runs/${encodeURIComponent(runId)}`);
    const payload = (await response.json()) as { run?: DecisionAgentRunRecord; error?: string };
    if (!response.ok || !payload.run) {
      setError(payload.error ?? "Run not found.");
      setRun(null);
      setLoading(false);
      return;
    }
    setError(null);
    setRun(payload.run);
    setLoading(false);
  }, [runId]);

  const retry = useCallback(async () => {
    if (!run || retryingLock.current) return;
    retryingLock.current = true;
    setRetrying(true);
    try {
      const response = await fetch("/api/v1/decision-agents/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: run.title,
          purpose: run.purpose,
          config: run.config,
          input: run.input,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const payload = (await response.json()) as { runId?: string; error?: string };
      if (!response.ok || !payload.runId) {
        throw new Error(payload.error ?? "Could not retry this run.");
      }
      router.push(
        `/decision-agents/results/${encodeURIComponent(payload.runId)}?from=${encodeURIComponent(from)}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not retry this run.");
      retryingLock.current = false;
      setRetrying(false);
    }
  }, [from, router, run]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!run || run.status === "completed" || run.status === "failed") return;
    const timer = window.setInterval(() => {
      void load();
    }, 1600);
    return () => window.clearInterval(timer);
  }, [load, run]);

  if (loading) {
    return (
      <PageShell className="zdec-report-shell">
        <div className="zdec-report">
          <p className="zdec-report-loading">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading this run…
          </p>
        </div>
      </PageShell>
    );
  }

  if (error || !run) {
    return (
      <PageShell className="zdec-report-shell">
        <div className="zdec-report">
          <h1>{error?.includes("decision_agent_runs") ? "Report storage is not ready" : "Run not found"}</h1>
          <p>{error ?? "This report is not available for your account."}</p>
          <Link href={from} className="prep-btn prep-btn-secondary">
            Back to form
          </Link>
        </div>
      </PageShell>
    );
  }

  const report = run.report;
  const inProgress = run.status === "running";

  return (
    <PageShell className="zdec-report-shell">
      <article className="zdec-report">
        <header className="zdec-report-top">
          <p className="studio-kicker">Research report</p>
          <h1>{report.title}</h1>
          <p className="zdec-report-meta">
            Started {new Date(run.createdAt).toLocaleString()}
            {report.executedAt ? ` · Updated ${new Date(report.executedAt).toLocaleString()}` : ""}
          </p>
          <div className="zdec-report-actions">
            <Link href={from} className="prep-btn prep-btn-secondary">
              Back to form
            </Link>
            <Link href="/decision-agents/create" className="studio-primary">
              Run new analysis
            </Link>
          </div>
        </header>

        {inProgress ? (
          <p className="zdec-report-loading" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> Agents are still running. This page updates from the
            server — it is not a previous report.
          </p>
        ) : null}

        {run.status === "failed" ? (
          <p className="zplat-error" role="alert">
            {run.error ?? "This run failed."}
            <button
              type="button"
              className="prep-btn prep-btn-secondary"
              disabled={retrying}
              onClick={() => {
                void retry();
              }}
            >
              {retrying ? "Retrying…" : "Retry this analysis"}
            </button>
          </p>
        ) : null}

        <section className="zdec-report-card">
          <h2>Overall assessment</h2>
          <p className={`zdec-report-overall is-${report.overall}`}>
            {report.insufficientVerifiedInformation
              ? "Insufficient verified information"
              : report.overall.toUpperCase()}
          </p>
          <p>{report.overallExplanation}</p>
          <p>
            Evidence quality: <strong>{report.evidenceQuality}</strong>
          </p>
        </section>

        <section className="zdec-report-card">
          <h2>Current IPO status</h2>
          {report.ipoStatusVerified && report.ipoStatus ? (
            <p>{report.ipoStatus}</p>
          ) : (
            <p>Insufficient verified information — no official or exchange source confirmed a current IPO status in this run.</p>
          )}
        </section>

        <section className="zdec-report-card">
          <h2>Agent execution</h2>
          <ul className="zdec-report-status">
            {report.agents.map((agent) => (
              <li key={agent.id} className={statusClass(agent.status)}>
                <strong>{agent.name}</strong>
                <span>{statusLabel(agent.status)}</span>
              </li>
            ))}
          </ul>
        </section>

        {report.agents.map((agent) => (
          <details key={agent.id} className={`zdec-report-agent ${statusClass(agent.status)}`} open>
            <summary>
              <span>{agent.name}</span>
              <b>{statusLabel(agent.status)}</b>
            </summary>
            <p className="zdec-report-role">{agent.role}</p>
            {agent.error ? <p className="zplat-error">{agent.error}</p> : null}
            {agent.summary ? <p>{agent.summary}</p> : <p>No summary yet.</p>}

            {agent.verifiedFacts.length ? (
              <div>
                <h3>Verified from retrieved sources</h3>
                <ul>
                  {agent.verifiedFacts.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {agent.estimates.length ? (
              <div>
                <h3>Estimates (not treated as facts)</h3>
                <ul>
                  {agent.estimates.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {agent.assumptions.length ? (
              <div>
                <h3>Assumptions</h3>
                <ul>
                  {agent.assumptions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {agent.unknowns.length || agent.uncertainties.length || agent.missingInformation.length ? (
              <div>
                <h3>Unknown / missing</h3>
                <ul>
                  {[...agent.unknowns, ...agent.uncertainties, ...agent.missingInformation].map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {agent.risks.length ? (
              <div>
                <h3>Risks</h3>
                <ul>
                  {agent.risks.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {agent.counterarguments.length || agent.conflicts.length ? (
              <div>
                <h3>Counterarguments and conflicts</h3>
                <ul>
                  {[...agent.counterarguments, ...agent.conflicts].map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {agent.dates.length ? (
              <div>
                <h3>Dates mentioned in sources</h3>
                <ul>
                  {agent.dates.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <h3>Sources</h3>
            {agent.sources.length ? (
              <ul className="zdec-report-sources">
                {agent.sources.map((source) => (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="noreferrer noopener">
                      {source.title || source.name}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <small>
                      {sourceKindLabel(source.kind)}
                      {source.publicationDate ? ` · Published ${source.publicationDate}` : " · Publication date not in retrieval"}
                      {source.retrievedAt ? ` · Retrieved ${new Date(source.retrievedAt).toLocaleString()}` : ""}
                    </small>
                    {source.snippet ? <p>{source.snippet}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No sources were retrieved for this agent.</p>
            )}
          </details>
        ))}

        <section className="zdec-report-card">
          <h2>Financial analysis</h2>
          {report.financialAnalysis ? (
            <p>{report.financialAnalysis}</p>
          ) : (
            <p>Insufficient verified information — no valuation or subscription figures were taken from retrieved official sources.</p>
          )}
        </section>

        <section className="zdec-report-card">
          <h2>Final balanced assessment</h2>
          <p>{report.overallExplanation}</p>
          <p>
            Wave does not recommend applying automatically and does not guarantee listing gains.
          </p>
          <h3>Next steps</h3>
          <ul>
            {report.nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </section>
      </article>
    </PageShell>
  );
}
