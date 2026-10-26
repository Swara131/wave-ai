"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import StatusBadge from "@/components/ui/StatusBadge";
import ErrorState from "@/components/ui/ErrorState";
import Skeleton from "@/components/ui/Skeleton";
import AgentWorkflowCanvas from "@/components/agents/workspace/AgentWorkflowCanvas";
import { buildWorkflowFromAgent } from "@/lib/agents/workflow-nodes";
import AgentResultRenderer from "@/components/agents/results/AgentResultRenderer";
import TicketEvidenceReport from "@/components/agents/platform/TicketEvidenceReport";
import type {
  AgentPlatformLifecycle,
  PlatformCheckResult,
} from "@/lib/agents/platform/lifecycle-types";
import { agentRunInputPath } from "@/lib/agents/platform/run-input-path";
import type { AgentRequirement, AgentRequirementsResult } from "@/lib/agents/requirements/types";
import type { RecordAnalysisResult } from "@/lib/agents/runtime/analysis/record-validation";
import type {
  DatabaseQueryStatus,
  TestRunOutcomeKind,
} from "@/lib/agents/platform/test-run-outcome";

function failedChecks(lifecycle: AgentPlatformLifecycle | null): PlatformCheckResult[] {
  return (lifecycle?.checks ?? []).filter((check) => check.status === "fail");
}

function failureReason(
  lifecycle: AgentPlatformLifecycle | null,
  extras: Array<string | null | undefined> = []
): string | null {
  const fromChecks = failedChecks(lifecycle)
    .map((check) => check.message?.trim())
    .filter((message): message is string => Boolean(message));
  const fromExtras = extras
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item));
  const unique = [...new Set([...fromExtras, ...fromChecks])];
  return unique.length > 0 ? unique.join(" ") : null;
}

function stepIcon(status: string, running: boolean) {
  if (status === "pass") return <Check className="h-4 w-4" />;
  if (status === "fail") return <X className="h-4 w-4" />;
  if (status === "needs_attention") return <AlertTriangle className="h-4 w-4" />;
  if (running) return <Loader2 className="h-4 w-4 animate-spin" />;
  return "○";
}

export default function AgentTestWorkspace() {
  const params = useParams();
  const router = useRouter();
  const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
  const [requirements, setRequirements] = useState<AgentRequirementsResult | null>(null);
  const [lifecycle, setLifecycle] = useState<AgentPlatformLifecycle | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<TestRunOutcomeKind | null>(null);
  const [queryStatus, setQueryStatus] = useState<DatabaseQueryStatus>("not_run");
  const [recordsProcessed, setRecordsProcessed] = useState(0);
  const [analysis, setAnalysis] = useState<RecordAnalysisResult | null>(null);
  const [phase, setPhase] = useState<"idle" | "preparing" | "running">("idle");
  const [proposalId, setProposalId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const [reqRes, verifyRes] = await Promise.all([
        fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/requirements?stage=test`),
        fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/platform/verify`),
      ]);
      const reqPayload = (await reqRes.json()) as AgentRequirementsResult;
      const verifyPayload = (await verifyRes.json()) as { lifecycle?: AgentPlatformLifecycle };
      setRequirements(reqPayload);
      const nextLifecycle = verifyPayload.lifecycle ?? null;
      setLifecycle(nextLifecycle);
      if (!reqPayload.ready) {
        router.replace(`/agents/${encodeURIComponent(agentId)}/prepare`);
        return;
      }
      if (reqPayload.runMissing?.length) {
        router.replace(agentRunInputPath(agentId, reqPayload.runMissing));
      }
    } catch {
      setError("Could not load the test workspace.");
    } finally {
      setLoading(false);
    }
  }, [agentId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const runFullTest = async () => {
    if (!agentId) return;
    setRunning(true);
    setPhase("preparing");
    setError(null);
    setRunSummary(null);
    setOutcome(null);
    setAnalysis(null);
    setRecordsProcessed(0);
    setQueryStatus("not_run");
    setProposalId(null);
    window.setTimeout(() => setPhase("running"), 280);
    try {
      const response = await fetch(
        `/api/v1/agents/${encodeURIComponent(agentId)}/platform/test`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      );
      const payload = (await response.json()) as {
        success?: boolean;
        outcome?: TestRunOutcomeKind;
        queryStatus?: DatabaseQueryStatus;
        recordsProcessed?: number;
        analysis?: RecordAnalysisResult | null;
        lifecycle?: AgentPlatformLifecycle;
        runSummary?: string | null;
        runError?: string | null;
        error?: string;
        missing?: AgentRequirement[];
        proposalId?: string | null;
      };
      if (payload.missing?.length) {
        router.replace(`/agents/${encodeURIComponent(agentId)}/prepare`);
        return;
      }
      setLifecycle(payload.lifecycle ?? null);
      setRunSummary(payload.runSummary ?? null);
      setAnalysis(payload.analysis ?? null);
      setQueryStatus(payload.queryStatus ?? "not_run");
      setRecordsProcessed(payload.recordsProcessed ?? 0);
      setProposalId(payload.proposalId ?? null);
      const nextOutcome =
        payload.outcome ??
        (payload.success ? "success" : response.ok ? "failed" : "failed");
      setOutcome(nextOutcome);
      if (!response.ok && !payload.runSummary && !payload.analysis) {
        setError(payload.error ?? payload.runError ?? "The test run failed.");
      } else if (nextOutcome === "failed") {
        setError(payload.runError ?? payload.error ?? failureReason(payload.lifecycle ?? null));
      }
    } catch (err) {
      setOutcome("failed");
      setError(err instanceof Error ? err.message : "Test failed.");
    } finally {
      setRunning(false);
      setPhase("idle");
    }
  };

  const execution = lifecycle?.checks.find((check) => check.id === "execution");
  const failed = failedChecks(lifecycle);
  const reason = error ?? failureReason(lifecycle);
  const fixCheck = failed.find((check) => check.fixHref);
  const testTone =
    outcome === "success"
      ? "success"
      : outcome === "empty"
        ? "warning"
        : outcome === "failed"
          ? "danger"
          : "neutral";

  if (loading || (requirements && (!requirements.ready || requirements.runMissing?.length))) {
    return (
      <PageShell maxWidth="7xl" className="zplat-page ztest-page">
        <Skeleton lines={4} />
      </PageShell>
    );
  }

  const checks = lifecycle?.checks ?? [];
  const showEvidence = Boolean(analysis) || outcome === "empty";

  return (
    <PageShell maxWidth="7xl" className="zplat-page ztest-page">
      <header className="prep-header ztest-header">
        <div>
          <p className="prep-kicker">Test environment</p>
          <h1>{requirements?.agentName ?? agentId}</h1>
        </div>
        <StatusBadge tone={testTone === "neutral" ? (requirements?.ready ? "success" : "warning") : testTone}>
          {outcome === "success"
            ? "Test produced real results"
            : outcome === "empty"
              ? "No records analyzed"
              : outcome === "failed"
                ? "Test did not succeed"
                : requirements?.ready
                  ? "Ready to test"
                  : "Not ready"}
        </StatusBadge>
        <Link href={`/agents/${encodeURIComponent(agentId)}/prepare`} className="zplat-btn zplat-btn-ghost">
          Edit setup
        </Link>
      </header>

      <div className="ztest-layout">
        <section className="ds-panel ztest-input">
          <h2>Input</h2>
          <p className="ztest-lead">
            Run a live test against the data source you verified in Prepare. HTTP 200 is not
            treated as success. Sample rows stay labeled as test data. Scheduling uses the
            existing Wave scheduler only if this agent already has a schedule configured.
          </p>
          <p>
            <Link href={`/agents/${encodeURIComponent(agentId)}/prepare`}>
              Configure or recover data source
            </Link>
          </p>
          <ul className="prep-ready-list">
            {(requirements?.requirements ?? [])
              .filter((item) => item.required)
              .map((item) => (
                <li key={item.key}>
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                  {item.label}
                </li>
              ))}
          </ul>
          <button
            type="button"
            className="prep-btn prep-btn-primary"
            disabled={running}
            onClick={() => void runFullTest()}
          >
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {phase === "preparing" ? "Preparing…" : "Running…"}
              </>
            ) : (
              "Run Test"
            )}
          </button>
          {showEvidence && outcome ? (
            <TicketEvidenceReport
              outcome={outcome}
              queryStatus={queryStatus}
              recordsProcessed={recordsProcessed}
              analysis={analysis}
              report={runSummary}
              error={reason}
              onRetry={() => void runFullTest()}
            />
          ) : null}
          {!showEvidence && runSummary && outcome === "success" ? (
            <AgentResultRenderer
              result={runSummary}
              status="completed"
              onRetry={() => void runFullTest()}
            />
          ) : null}
          {!showEvidence && outcome === "awaiting_approval" ? (
            <ErrorState
              title="Waiting for your approval"
              description={
                runSummary ??
                "This agent cannot continue until you approve it on the Approvals page."
              }
              fixLabel="Open Approvals"
              fixHref={
                proposalId
                  ? `/approvals?proposal=${encodeURIComponent(proposalId)}`
                  : "/approvals"
              }
            />
          ) : null}
          {!showEvidence && outcome === "failed" ? (
            <ErrorState
              title="Wave couldn't finish this test."
              description={reason ?? "The agent stopped before producing a result."}
              fixLabel={
                /No file is uploaded/i.test(reason ?? "")
                  ? "Upload a file"
                  : fixCheck?.fixLabel
              }
              fixHref={
                /No file is uploaded/i.test(reason ?? "")
                  ? `/agents/${encodeURIComponent(agentId)}/prepare`
                  : fixCheck?.fixHref
              }
              onFix={() => void runFullTest()}
              technical={execution?.message ?? error}
            />
          ) : null}
        </section>

        <section className="ds-panel ztest-live">
          <h2>Live workflow</h2>
          <ol className="ztest-steps">
            {checks.length === 0 ? (
              <li className="ztest-step is-idle">
                <span>○</span>
                Waiting to start
              </li>
            ) : (
              checks.map((check) => (
                <li
                  key={check.id}
                  className={`ztest-step is-${running && check.status === "not_run" ? "running" : check.status}`}
                >
                  <span aria-hidden="true">{stepIcon(check.status, running)}</span>
                  <div>
                    <strong>{check.label}</strong>
                    <small>
                      {check.message ??
                        (check.status === "pass"
                          ? "Completed"
                          : check.status === "fail"
                            ? "Failed"
                            : check.status === "needs_attention"
                              ? "Needs attention"
                              : running
                                ? "Running"
                                : "Idle")}
                    </small>
                  </div>
                </li>
              ))
            )}
          </ol>
          <div className="ztest-canvas">
            <AgentWorkflowCanvas
              nodes={buildWorkflowFromAgent({
                name: requirements?.agentName ?? agentId,
                goal: null,
                instructions: null,
                tools: [],
                capabilityLabels: [],
                protected: true,
              })}
            />
          </div>
        </section>
      </div>
    </PageShell>
  );
}
