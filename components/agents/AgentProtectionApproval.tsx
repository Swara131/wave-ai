"use client";

import Link from "next/link";
import { Shield } from "lucide-react";
import { riskLevelLabel } from "@/lib/agents/protection/summaries";
import type { RiskSeverity } from "@/lib/risk-types";

export interface AgentProtectionApprovalProps {
  proposalId: string;
  runId?: string | null;
  summary: string;
  why: string;
  riskLevel?: RiskSeverity;
  details?: Record<string, unknown>;
  onResolved?: (result: {
    decision: "approved" | "rejected";
    runSummary?: string | null;
  }) => void;
}

function formatDetailValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  return JSON.stringify(value);
}

export default function AgentProtectionApproval({
  proposalId,
  summary,
  why,
  riskLevel = "medium",
  details,
}: AgentProtectionApprovalProps) {
  const href = `/approvals?proposal=${encodeURIComponent(proposalId)}`;

  return (
    <section className="asw-protection-card ds-panel" aria-live="polite">
      <div className="asw-protection-header">
        <Shield className="h-5 w-5" aria-hidden="true" />
        <div>
          <p className="asw-protection-kicker">Waiting on the Approvals page</p>
          <p className="asw-protection-risk">{riskLevelLabel(riskLevel)}</p>
        </div>
      </div>

      <div className="asw-protection-body">
        <p className="asw-protection-summary">{summary}</p>
        <p className="asw-protection-why">
          <strong>Why:</strong> {why}
        </p>

        {details && Object.keys(details).length > 0 ? (
          <dl className="asw-protection-details">
            {Object.entries(details).map(([key, value]) =>
              value == null ? null : (
                <div key={key}>
                  <dt>{key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}</dt>
                  <dd>{formatDetailValue(value)}</dd>
                </div>
              )
            )}
          </dl>
        ) : null}
      </div>

      <div className="asw-protection-actions">
        <Link href={href} className="ds-btn ds-btn-primary">
          Review on Approvals
        </Link>
      </div>
    </section>
  );
}
