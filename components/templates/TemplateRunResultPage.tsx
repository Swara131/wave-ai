"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import PageShell from "@/components/ui/PageShell";
import type { AgentRunRecord } from "@/lib/agents/runtime-types";

export default function TemplateRunResultPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId ?? "";
  const [run, setRun] = useState<AgentRunRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/v1/runs/${encodeURIComponent(runId)}`);
      const payload = (await response.json()) as { run?: AgentRunRecord; error?: string };
      if (cancelled) return;
      if (response.status === 401) {
        setRun(null);
        setNeedsSignIn(true);
        setError("Sign in to view this saved result.");
        setLoading(false);
        return;
      }
      if (!response.ok || !payload.run) {
        setRun(null);
        setError(payload.error ?? "You do not have access to this result.");
        setLoading(false);
        return;
      }
      setRun(payload.run);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const metadata = (run?.metadata ?? {}) as Record<string, unknown>;
  const templateName =
    (typeof metadata.templateName === "string" && metadata.templateName) || "Template result";
  const templateSlug = typeof metadata.templateSlug === "string" ? metadata.templateSlug : "";
  const executionStatus =
    typeof metadata.executionStatus === "string" ? metadata.executionStatus : run?.status;
  const resultPayload = metadata.resultPayload;
  const retryHref = templateSlug ? `/preview/${encodeURIComponent(templateSlug)}` : "/#templates";

  return (
    <PageShell maxWidth="4xl">
      <div className="ds-panel p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">Saved result</p>
        <h1 className="mt-2 text-2xl font-semibold">{templateName}</h1>
        {loading ? <p className="mt-4 text-sm text-[var(--text-secondary)]">Loading result…</p> : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4" role="alert">
            <p className="font-medium">Result not found</p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{error}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              {needsSignIn ? (
                <Link href={`/login?redirectTo=${encodeURIComponent(`/runs/${runId}`)}`} className="text-sm font-semibold text-[var(--primary)]">
                  Sign in
                </Link>
              ) : null}
              <Link href="/notifications" className="text-sm font-semibold text-[var(--primary)]">
                Back to notifications
              </Link>
            </div>
          </div>
        ) : null}
        {run ? (
          <div className="mt-6 space-y-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase text-[var(--text-secondary)]">Status</dt>
                <dd className="font-medium">{executionStatus}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-[var(--text-secondary)]">Run time</dt>
                <dd>{run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase text-[var(--text-secondary)]">Summary</dt>
                <dd>{run.summary}</dd>
              </div>
              {typeof metadata.safetyDecision === "string" && metadata.safetyDecision ? (
                <div>
                  <dt className="text-xs uppercase text-[var(--text-secondary)]">Safety</dt>
                  <dd>
                    {metadata.safetyDecision}
                    {typeof metadata.approvalState === "string" ? ` · ${metadata.approvalState}` : ""}
                  </dd>
                </div>
              ) : null}
              {Array.isArray(metadata.sources) ? (
                <div>
                  <dt className="text-xs uppercase text-[var(--text-secondary)]">Sources</dt>
                  <dd>{metadata.sources.join(", ")}</dd>
                </div>
              ) : null}
            </dl>
            {run.errorMessage ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{run.errorMessage}</p>
            ) : null}
            {resultPayload ? (
              <pre className="overflow-auto rounded-xl bg-[var(--surface-muted)] p-4 text-xs">
                {JSON.stringify(resultPayload, null, 2)}
              </pre>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Link href={retryHref} className="landing-cta-primary rounded-full px-4 py-2 text-sm font-semibold">
                Return to template
              </Link>
              <Link href="/notifications" className="landing-cta-secondary rounded-full px-4 py-2 text-sm font-semibold">
                Notifications
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
