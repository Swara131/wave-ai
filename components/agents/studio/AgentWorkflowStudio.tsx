"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import WorkflowEditorCanvas from "@/components/agents/workflow-builder/WorkflowEditorCanvas";
import WorkflowValidationBar from "@/components/agents/workflow-builder/WorkflowValidationBar";
import type { AgentInterpretation } from "@/lib/agents/builder-types";
import type {
  AgentWorkflowGraph,
  AgentWorkflowState,
  WorkflowSafetyDiff,
  WorkflowValidationResult,
} from "@/lib/agents/workflow/types";
import type { LiveRunStep } from "@/components/agents/runtime/AgentLiveRunPanel";
import { matchWorkflowNodeToStep } from "@/lib/agents/workflow/run-status";

interface AgentWorkflowStudioProps {
  agentSlug: string | null;
  interpretation: AgentInterpretation | null;
  workflowGraph: AgentWorkflowGraph | null;
  workflowState: AgentWorkflowState | null;
  validation: WorkflowValidationResult | null;
  safetyDiff: WorkflowSafetyDiff | null;
  dirty: boolean;
  saving: boolean;
  verifying: boolean;
  publishing: boolean;
  safetyReviewing: boolean;
  error: string | null;
  liveSteps: LiveRunStep[];
  nlEdit: string;
  onNlEditChange: (value: string) => void;
  onApplyNlEdit: () => void;
  generating: boolean;
  onWorkflowChange: (graph: AgentWorkflowGraph) => void;
  onVerify: () => void;
  onSaveDraft: () => void;
  onDiscard: () => void;
  onConfirm: () => void;
  onSafetyReview: () => void;
}

export default function AgentWorkflowStudio({
  agentSlug,
  interpretation,
  workflowGraph,
  workflowState,
  validation,
  safetyDiff,
  dirty,
  saving,
  verifying,
  publishing,
  safetyReviewing,
  error,
  liveSteps,
  nlEdit,
  onNlEditChange,
  onApplyNlEdit,
  generating,
  onWorkflowChange,
  onVerify,
  onSaveDraft,
  onDiscard,
  onConfirm,
  onSafetyReview,
}: AgentWorkflowStudioProps) {
  return (
    <div className="studio-workflow">
      <header className="studio-workflow-top">
        <div className="studio-workflow-title">
          <Link href="/agents/create" className="studio-back">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Prompt
          </Link>
          <div>
            <p className="studio-kicker">Editable workflow</p>
            <h1>{interpretation?.displayName ?? "Workflow"}</h1>
          </div>
        </div>
        <div className="studio-workflow-refine">
          <input
            className="studio-nl-input"
            value={nlEdit}
            onChange={(event) => onNlEditChange(event.target.value)}
            placeholder="Refine: also notify me in Wave at 9am…"
            aria-label="Refine workflow in plain language"
          />
          <button
            type="button"
            className="studio-ghost"
            disabled={!nlEdit.trim() || generating}
            onClick={onApplyNlEdit}
          >
            Update
          </button>
        </div>
      </header>

      <div className="studio-workflow-canvas">
        {workflowGraph ? (
          <WorkflowEditorCanvas
            graph={workflowGraph}
            onChange={onWorkflowChange}
            agentSlug={agentSlug}
            runStatuses={Object.fromEntries(
              workflowGraph.nodes.map((node) => [
                node.id,
                matchWorkflowNodeToStep(
                  node,
                  liveSteps.map((step) => ({
                    key: step.key,
                    label: step.label,
                    detail: step.detail ?? null,
                    status: step.status,
                  }))
                ),
              ])
            )}
          />
        ) : (
          <div className="studio-workflow-empty">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            Building the canvas…
          </div>
        )}
      </div>

      {error ? (
        <p className="studio-error studio-error-bar" role="alert">
          {error}
        </p>
      ) : null}
      {saving ? <p className="studio-saving">Saving draft…</p> : null}

      <div className="studio-workflow-footer">
        <WorkflowValidationBar
          validation={validation}
          safetyDiff={safetyDiff}
          hasDraft={Boolean(workflowState?.draft)}
          unsaved={dirty}
          verifying={verifying}
          publishing={publishing}
          reviewing={safetyReviewing}
          safetyReviewedAt={workflowState?.safetyReviewedAt ?? null}
          onVerify={onVerify}
          onSaveDraft={onSaveDraft}
          onDiscard={onDiscard}
          onPublish={onConfirm}
          onSafetyReview={onSafetyReview}
          publishLabel={publishing ? "Opening next step…" : "Confirm workflow"}
          publishDisabled={publishing || !workflowGraph}
          extraAction={
            <span className="studio-confirm-hint">
              Next: prepare data source
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          }
        />
      </div>
    </div>
  );
}
