"use client";

import Link from "next/link";
import { Check, Loader2, XCircle } from "lucide-react";
import AgentResultRenderer from "@/components/agents/results/AgentResultRenderer";
import type { RunAgentResult } from "@/lib/agents/runtime/types";

export interface LiveRunStep {
  key: string;
  label: string;
  detail?: string | null;
  status: string;
}

export default function AgentLiveRunPanel({
  running,
  steps,
  result,
  error,
  onRetry,
}: {
  running: boolean;
  steps: LiveRunStep[];
  result?: RunAgentResult | null;
  error?: string | null;
  onRetry?: () => void;
}) {
  const displaySteps =
    result?.steps?.length && !running
      ? result.steps.map((step) => ({
          key: step.key,
          label: step.label,
          detail: step.detail,
          status: step.status,
        }))
      : steps;

  const delivery = result?.delivery;
  const emailFailed = delivery?.email?.status === "failed" || delivery?.status === "failed";
  const emailSent = delivery?.email?.status === "sent";

  return (
    <section className="arc-live" aria-live="polite">
      {running ? <p className="arc-live-kicker">Running agent</p> : null}
      {displaySteps.length > 0 ? (
        <ol className="att-timeline">
          {displaySteps.map((step, index) => {
            const failed = step.status === "failed";
            const waitingApproval =
              step.status === "needs_approval" ||
              step.label.toUpperCase().includes("WAITING FOR APPROVAL");
            const done = !failed && !waitingApproval && step.status !== "running";
            return (
              <li
                key={`${step.key}-${index}`}
                className={`att-timeline-item att-timeline-item-visible ${failed ? "att-step-failed" : ""} ${waitingApproval ? "att-step-approval" : ""}`}
              >
                <span className="att-timeline-marker" aria-hidden="true">
                  {failed ? (
                    <XCircle className="h-3.5 w-3.5" />
                  ) : done && !running ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                  ) : running && index === displaySteps.length - 1 ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                  )}
                </span>
                <div className="att-timeline-body">
                  <p className="att-timeline-title">{step.label}</p>
                  {waitingApproval ? (
                    <p className="att-timeline-detail">WAITING FOR APPROVAL</p>
                  ) : null}
                  {step.detail ? <p className="att-timeline-detail">{step.detail}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : running ? (
        <p className="arc-live-wait">
          <Loader2 className="h-4 w-4 animate-spin" /> Starting live execution…
        </p>
      ) : null}

      {result?.status === "completed" ? (
        <div className="arc-result">
          <p className="arc-result-title">Agent completed</p>
          {result.summary ? (
            <AgentResultRenderer
              result={result.summary}
              status={result.status}
              executionDetails={result.steps}
              onRetry={onRetry}
            />
          ) : null}
          <ul className="arc-delivery">
            {emailSent ? (
              <li>✓ Email delivered{delivery?.email?.destination ? ` to ${delivery.email.destination}` : ""}</li>
            ) : null}
            {emailFailed ? (
              <li>
                ✕ Email failed
                {delivery?.email?.error || delivery?.error
                  ? `: ${delivery.email?.error ?? delivery.error}`
                  : ""}
              </li>
            ) : null}
            {result.runId ? <li>Run ID: {result.runId}</li> : null}
          </ul>
        </div>
      ) : null}

      {result?.status === "awaiting_approval" ? (
        <p className="arc-result-title">
          WAITING_FOR_APPROVAL — this agent has not run.{" "}
          <Link
            href={
              result.proposalId
                ? `/approvals?proposal=${encodeURIComponent(result.proposalId)}`
                : "/approvals"
            }
          >
            Review on Approvals
          </Link>
        </p>
      ) : null}

      {result?.status === "failed" || error ? (
        <p className="att-error" role="alert">
          {error ?? result?.error ?? "The agent could not finish."}
        </p>
      ) : null}
    </section>
  );
}

export async function pollLatestRunSteps(
  slug: string
): Promise<LiveRunStep[]> {
  const response = await fetch(`/api/v1/agents/${encodeURIComponent(slug)}/runs?limit=1`);
  const payload = (await response.json()) as {
    runs?: Array<{
      steps?: Array<{
        key?: string;
        label: string;
        detail?: string | null;
        status: string;
      }>;
    }>;
  };
  const run = payload.runs?.[0];
  return (run?.steps ?? []).map((step) => ({
    key: step.key ?? step.label,
    label: step.label,
    detail: step.detail ?? null,
    status: step.status,
  }));
}
