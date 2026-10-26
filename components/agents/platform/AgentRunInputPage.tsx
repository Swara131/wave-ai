"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, Loader2, Link2 } from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import Skeleton from "@/components/ui/Skeleton";
import ErrorState from "@/components/ui/ErrorState";
import type { AgentRequirement, AgentRequirementsResult } from "@/lib/agents/requirements/types";
import { saveLastRunResult } from "@/lib/agents/runtime/last-run-result";
import type { AgentPlatformLifecycle } from "@/lib/agents/platform/lifecycle-types";
import type { TestRunOutcomeKind } from "@/lib/agents/platform/test-run-outcome";

const PROCESS_STEPS = [
  "Reading the link",
  "Extracting real content",
  "Writing a summary from what was fetched",
];

export default function AgentRunInputPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
  const [requirements, setRequirements] = useState<AgentRequirementsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<TestRunOutcomeKind | null>(null);
  const [processIndex, setProcessIndex] = useState(0);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const response = await fetch(
        `/api/v1/agents/${encodeURIComponent(agentId)}/requirements?stage=test`
      );
      const payload = (await response.json()) as AgentRequirementsResult;
      setRequirements(payload);
      if (!payload.ready) {
        router.replace(`/agents/${encodeURIComponent(agentId)}/prepare`);
        return;
      }
      if (!payload.runMissing.length) {
        router.replace(`/agents/${encodeURIComponent(agentId)}/test`);
      }
    } catch {
      setError("Could not load this run page.");
    } finally {
      setLoading(false);
    }
  }, [agentId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!running) return;
    setProcessIndex(0);
    const timer = window.setInterval(() => {
      setProcessIndex((index) => (index + 1) % PROCESS_STEPS.length);
    }, 1400);
    return () => window.clearInterval(timer);
  }, [running]);

  const runFields = useMemo(
    () =>
      (requirements?.requirements ?? []).filter(
        (item) => item.scope === "run" && item.inputType !== "none"
      ),
    [requirements]
  );

  const canRun = runFields
    .filter((item) => item.required)
    .every((item) => (drafts[item.key] ?? item.value ?? "").trim().length > 0);

  const runAgent = async () => {
    if (!agentId || !canRun) return;
    setRunning(true);
    setError(null);
    setOutcome(null);
    const runInputs: Record<string, string> = {};
    for (const field of runFields) {
      const value = (drafts[field.key] ?? field.value ?? "").trim();
      if (value) runInputs[field.key] = value;
    }
    try {
      const response = await fetch(
        `/api/v1/agents/${encodeURIComponent(agentId)}/platform/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runInputs,
            source_url: runInputs.source_url,
            task: runInputs.source_url
              ? `Summarize this public link: ${runInputs.source_url}${
                  runInputs.summary_focus ? `. Focus: ${runInputs.summary_focus}` : ""
                }`
              : undefined,
          }),
        }
      );
      const payload = (await response.json()) as {
        success?: boolean;
        outcome?: TestRunOutcomeKind;
        runSummary?: string | null;
        runError?: string | null;
        error?: string;
        missing?: AgentRequirement[];
        lifecycle?: AgentPlatformLifecycle;
      };
      if (payload.missing?.length) {
        router.replace(`/agents/${encodeURIComponent(agentId)}/prepare`);
        return;
      }
      const nextOutcome = payload.outcome ?? (payload.success ? "success" : "failed");
      setOutcome(nextOutcome);
      const summary = payload.runSummary?.trim() ?? "";
      if (summary && nextOutcome !== "failed") {
        saveLastRunResult({
          agentId,
          agentName: requirements?.agentName ?? "Summary",
          sourceUrl: runInputs.source_url,
          focus: runInputs.summary_focus,
          summary,
          createdAt: new Date().toISOString(),
        });
        router.push(`/agents/${encodeURIComponent(agentId)}/result`);
        return;
      }
      setError(
        payload.runError ??
          payload.error ??
          "Wave could not produce a real summary from that link."
      );
    } catch (err) {
      setOutcome("failed");
      setError(err instanceof Error ? err.message : "The run failed.");
    } finally {
      setRunning(false);
    }
  };

  if (loading || (requirements && !requirements.ready)) {
    return (
      <PageShell layout="workspace" className="studio-shell">
        <Skeleton lines={4} />
      </PageShell>
    );
  }

  return (
    <PageShell layout="workspace" className="studio-shell">
      <div className="studio-prompt run-page">
        <div className="studio-prompt-glow" />
        <div className="studio-prompt-stage studio-prompt-stage-narrow">
          <p className="studio-kicker">
            <Link2 className="h-3.5 w-3.5" />
            Step · Provide a real source
          </p>
          <h1>Paste a link to summarize</h1>
          <p className="studio-lead">
            YouTube, an article, or any public page. Wave fetches that URL and
            summarizes only what it can actually read. It will not invent tickets,
            quotes, or video transcripts.
          </p>

          {runFields.map((field) => (
            <label key={field.key} className="run-field">
              <span>{field.label}</span>
              {field.inputType === "textarea" ? (
                <textarea
                  value={drafts[field.key] ?? field.value ?? ""}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                  placeholder={field.placeholder}
                  rows={3}
                />
              ) : (
                <input
                  type={field.inputType === "url" ? "url" : "text"}
                  value={drafts[field.key] ?? field.value ?? ""}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                  placeholder={field.placeholder ?? "https://"}
                  autoComplete="off"
                />
              )}
              <small>{field.description}</small>
            </label>
          ))}

          <div className="studio-actions">
            <button
              type="button"
              className="studio-primary studio-primary-lg"
              disabled={!canRun || running}
              onClick={() => void runAgent()}
            >
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Fetching real content…
                </>
              ) : (
                <>
                  Create summary
                  <ArrowRight className="h-4 w-4 studio-arrow-nudge" />
                </>
              )}
            </button>
            <Link href={`/agents/${encodeURIComponent(agentId)}/prepare`} className="run-back">
              Back to setup
            </Link>
          </div>

          {running ? (
            <ol className="studio-process">
              {PROCESS_STEPS.map((step, index) => (
                <li key={step} className={index === processIndex ? "is-current" : ""}>
                  <span />
                  {step}
                </li>
              ))}
            </ol>
          ) : null}

          {error && outcome !== "success" ? (
            <ErrorState
              title="No invented result."
              description={error}
              onFix={() => void runAgent()}
              fixLabel="Try another link"
            />
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}
