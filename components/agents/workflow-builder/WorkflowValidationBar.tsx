"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { WorkflowSafetyDiff, WorkflowValidationResult } from "@/lib/agents/workflow/types";
import { summarizeValidation } from "@/lib/agents/workflow/validate-workflow";

interface WorkflowValidationBarProps {
  validation: WorkflowValidationResult | null;
  safetyDiff: WorkflowSafetyDiff | null;
  hasDraft: boolean;
  unsaved?: boolean;
  verifying: boolean;
  publishing: boolean;
  reviewing?: boolean;
  safetyReviewedAt?: string | null;
  onVerify: () => void;
  onSaveDraft: () => void;
  onDiscard: () => void;
  onPublish: () => void;
  onSafetyReview?: () => void;
  publishLabel?: string;
  publishDisabled?: boolean;
  extraAction?: ReactNode;
}

export default function WorkflowValidationBar({
  validation,
  safetyDiff,
  hasDraft,
  unsaved,
  verifying,
  publishing,
  reviewing,
  safetyReviewedAt,
  onVerify,
  onSaveDraft,
  onDiscard,
  onPublish,
  onSafetyReview,
  publishLabel,
  publishDisabled,
  extraAction,
}: WorkflowValidationBarProps) {
  const summary = validation ? summarizeValidation(validation) : "Workflow not verified yet";

  return (
    <footer className="wfb-validation">
      <div className="wfb-validation-status">
        <p className={validation?.valid ? "wfb-validation-ok" : "wfb-validation-warn"}>
          {summary}
          {unsaved ? " · Unsaved changes" : ""}
          {validation?.safetyScore != null ? ` · Safety score ${validation.safetyScore}` : ""}
        </p>
        {validation?.highRisk ? (
          <p className="wfb-validation-safety">
            High-risk path: add an approval/safety node or complete safety review before activate.
          </p>
        ) : null}
        {safetyReviewedAt ? (
          <p className="wfb-validation-ok">Safety review recorded.</p>
        ) : null}
        {safetyDiff?.message ? (
          <p className="wfb-validation-safety">{safetyDiff.message}</p>
        ) : null}
        {validation?.issues.slice(0, 3).map((issue) => (
          <p key={issue.id} className={`wfb-validation-issue wfb-issue-${issue.severity}`}>
            {issue.message}{" "}
            {issue.actionHref ? (
              <Link href={issue.actionHref} className="wfb-validation-link">
                {issue.actionLabel ?? "Fix"}
              </Link>
            ) : null}
          </p>
        ))}
      </div>

      <div className="wfb-validation-actions">
        {hasDraft ? (
          <>
            <button type="button" className="wfb-btn wfb-btn-ghost" onClick={onDiscard}>
              Discard
            </button>
            <button type="button" className="wfb-btn wfb-btn-secondary" onClick={onSaveDraft}>
              Save Draft
            </button>
          </>
        ) : (
          <button type="button" className="wfb-btn wfb-btn-secondary" onClick={onSaveDraft}>
            Save Draft
          </button>
        )}
        {onSafetyReview ? (
          <button
            type="button"
            className="wfb-btn wfb-btn-secondary"
            disabled={reviewing}
            onClick={onSafetyReview}
          >
            {reviewing ? "Recording…" : "Safety review"}
          </button>
        ) : null}
        <button
          type="button"
          className="wfb-btn wfb-btn-secondary"
          disabled={verifying}
          onClick={onVerify}
        >
          {verifying ? "Verifying…" : "Verify Agent"}
        </button>
        {extraAction}
        <button
          type="button"
          className="wfb-btn wfb-btn-primary"
          disabled={publishDisabled ?? (!validation?.valid || publishing)}
          onClick={onPublish}
        >
          {publishLabel ?? (publishing ? "Publishing…" : "Verify & Publish")}
        </button>
      </div>
    </footer>
  );
}
