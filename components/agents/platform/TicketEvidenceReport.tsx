"use client";

import type { RecordAnalysisResult } from "@/lib/agents/runtime/analysis/record-validation";
import type { DatabaseQueryStatus, TestRunOutcomeKind } from "@/lib/agents/platform/test-run-outcome";
import AgentResultRenderer from "@/components/agents/results/AgentResultRenderer";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import { Database } from "lucide-react";

function queryStatusLabel(status: DatabaseQueryStatus): string {
  switch (status) {
    case "ok":
      return "Database query succeeded";
    case "empty":
      return "Database query succeeded; 0 records returned";
    case "unavailable":
      return "Database unavailable or disconnected";
    case "failed":
      return "Database query failed";
    default:
      return "Database query not run";
  }
}

export default function TicketEvidenceReport(props: {
  outcome: TestRunOutcomeKind;
  queryStatus: DatabaseQueryStatus;
  recordsProcessed: number;
  analysis: RecordAnalysisResult | null;
  report: string | null;
  error?: string | null;
  onRetry?: () => void;
}) {
  const analysis = props.analysis;
  const counts = {
    total: analysis?.analyzedCount ?? props.recordsProcessed,
    valid: analysis?.validCount ?? 0,
    missing: analysis?.missingEvidenceCount ?? 0,
    invalid: analysis?.invalidEvidenceCount ?? 0,
  };

  return (
    <div className="ztest-evidence">
      {analysis?.sourceLabel ? (
        <p className="ztest-source-label">
          Source: {analysis.sourceLabel}
          {/sample/i.test(analysis.sourceLabel) ? " — test data, not a live integration." : ""}
        </p>
      ) : null}
      <dl className="ztest-evidence-stats">
        <div>
          <dt>Query</dt>
          <dd data-status={props.queryStatus}>{queryStatusLabel(props.queryStatus)}</dd>
        </div>
        <div>
          <dt>Tickets checked</dt>
          <dd>{counts.total}</dd>
        </div>
        <div>
          <dt>Valid</dt>
          <dd>{counts.valid}</dd>
        </div>
        <div>
          <dt>Missing evidence</dt>
          <dd>{counts.missing}</dd>
        </div>
        <div>
          <dt>Invalid evidence</dt>
          <dd>{counts.invalid}</dd>
        </div>
      </dl>

      {props.outcome === "empty" ? (
        <EmptyState
          icon={Database}
          title="No support tickets to analyze"
          description="The configured database is empty. Wave did not invent tickets or validation results."
          actionLabel="Run test again"
          onAction={props.onRetry}
        />
      ) : null}

      {props.outcome === "failed" ? (
        <ErrorState
          title="This test did not succeed."
          description={
            props.error ||
            analysis?.errors[0] ||
            "A required step failed, or no records were processed."
          }
          onFix={props.onRetry}
        />
      ) : null}

      {analysis && analysis.findings.length > 0 ? (
        <div className="ztest-evidence-table-wrap">
          <h3>Ticket findings</h3>
          <table className="ztest-evidence-table">
            <thead>
              <tr>
                <th>Ticket ID</th>
                <th>Status</th>
                <th>Missing fields</th>
                <th>Invalid fields</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {analysis.findings.map((finding) => (
                <tr key={finding.recordId}>
                  <td>{finding.recordId}</td>
                  <td>{finding.validationStatus.replace(/_/g, " ")}</td>
                  <td>{finding.missingFields.join(", ") || "—"}</td>
                  <td>{finding.invalidFields.join(", ") || "—"}</td>
                  <td>{finding.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {analysis && analysis.nextSteps.length > 0 ? (
        <div className="ztest-evidence-next">
          <h3>Recommended corrective actions</h3>
          <ul>
            {analysis.nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {props.report && !(analysis && analysis.findings.length > 0) ? (
        <AgentResultRenderer
          result={props.report}
          status="completed"
          onRetry={props.onRetry}
        />
      ) : null}
    </div>
  );
}
