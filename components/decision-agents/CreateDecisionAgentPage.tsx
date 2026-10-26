"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import DecisionLiveRun from "@/components/decision-agents/DecisionLiveRun";
import DecisionWorkflowCanvas from "@/components/decision-agents/DecisionWorkflowCanvas";
import { DECISION_AGENT_TEMPLATES, type GeneratedDecisionAgentPreview } from "@/lib/decision-agents/types";

type Phase = "prompt" | "workflow" | "run";

export default function CreateDecisionAgentPage() {
  const searchParams = useSearchParams();
  const templateId = searchParams.get("template");
  const template = DECISION_AGENT_TEMPLATES.find((item) => item.id === templateId);

  const [prompt, setPrompt] = useState(template?.purpose ?? "");
  const [phase, setPhase] = useState<Phase>("prompt");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<GeneratedDecisionAgentPreview | null>(null);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (prompt.trim().length < 12) {
      setError("Describe the decisions this agent should make, in a full sentence.");
      return;
    }
    setGenerating(true);
    setError(null);
    setSavedSlug(null);
    try {
      const response = await fetch("/api/v1/decision-agents/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          templateId: template?.id,
          decisionType: template?.decisionType,
          name: template?.name,
        }),
      });
      const payload = (await response.json()) as {
        preview?: GeneratedDecisionAgentPreview;
        error?: string;
      };
      if (!response.ok || !payload.preview) {
        throw new Error(payload.error ?? "Could not generate the decision workflow.");
      }
      setPreview(payload.preview);
      setPhase("workflow");
      try {
        const saved = await persistPreview(payload.preview);
        if (saved) setSavedSlug(saved);
      } catch (saveErr) {
        setError(
          saveErr instanceof Error
            ? saveErr.message
            : "Workflow is ready, but it could not be saved to My Agents yet."
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate the decision workflow.");
      setPreview(null);
    } finally {
      setGenerating(false);
    }
  };

  const persistPreview = async (draft: GeneratedDecisionAgentPreview): Promise<string | null> => {
    const response = await fetch("/api/v1/decision-agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        purpose: draft.purpose,
        decisionType: draft.decisionType,
        config: draft.config,
      }),
    });
    const payload = (await response.json()) as { agent?: { slug: string }; error?: string };
    if (!response.ok || !payload.agent) {
      throw new Error(payload.error ?? "Could not save.");
    }
    return payload.agent.slug;
  };

  const handleSave = async (): Promise<string | null> => {
    if (!preview) return savedSlug;
    if (savedSlug) return savedSlug;
    setSaving(true);
    setError(null);
    try {
      const slug = await persistPreview(preview);
      setSavedSlug(slug);
      return slug;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async () => {
    const slug = await handleSave();
    if (!slug) return;
    setPhase("run");
  };

  return (
    <PageShell
      layout="workspace"
      className={phase === "workflow" ? "studio-shell studio-shell-scroll" : "studio-shell"}
    >
      {phase === "prompt" ? (
      <div className="zdec-studio">
        <ol className="prep-stepper">
          <li className="is-active">Prompt</li>
          <li>Workflow</li>
          <li>Live decisions</li>
        </ol>

          <div className="studio-prompt-stage">
            <p className="studio-kicker">Multiple decisions · one agent</p>
            <h1>What decisions should this agent make?</h1>
            <p className="studio-lead">
              Describe the real judgments — eligibility, risk, and whether to act. Wave will build a
              workflow of those decisions. It will not invent case values.
            </p>
            <label className="studio-prompt-field">
            <textarea
              rows={7}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder='Example: Build an assistant called "Jio IPO Research & Decision Assistant" that checks official sources, assesses investor risk, and never blindly recommends applying.'
            />
            </label>
            {error ? (
              <p className="zplat-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="studio-actions">
              <button
                type="button"
                className="studio-primary studio-primary-lg"
                disabled={generating || prompt.trim().length < 12}
                onClick={() => void handleGenerate()}
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Building workflow…
                  </>
                ) : (
                  <>
                    Generate workflow
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
              <Link href="/decision-agents" className="run-back">
                All decision agents
              </Link>
            </div>
          </div>
      </div>
      ) : null}

      {preview && phase === "workflow" ? (
        <div className="studio-workflow">
          <header className="studio-workflow-top">
            <div className="studio-workflow-title">
              <button type="button" className="studio-back" onClick={() => setPhase("prompt")}>
                Prompt
              </button>
              <div>
                <p className="studio-kicker">Editable workflow</p>
                <h1>{preview.name}</h1>
              </div>
            </div>
            <div className="zdec-wf-footer">
              <button type="button" className="studio-ghost" onClick={() => setPhase("prompt")}>
                Edit prompt
              </button>
              <button
                type="button"
                className="studio-ghost"
                disabled={saving || Boolean(savedSlug)}
                onClick={() => void handleSave()}
              >
                {saving ? "Saving…" : savedSlug ? "Saved" : "Save draft"}
              </button>
              <button
                type="button"
                className="studio-primary"
                disabled={saving}
                onClick={() => void handleConfirm()}
              >
                Confirm workflow
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </header>
          <div className="studio-workflow-canvas">
            <DecisionWorkflowCanvas
              config={preview.config}
              onChange={(config) => setPreview({ ...preview, config })}
            />
          </div>
          {error ? (
            <p className="studio-error studio-error-bar" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {preview && phase === "run" ? (
        <div className="zdec-studio">
          <ol className="prep-stepper">
            <li className="is-done">Prompt</li>
            <li className="is-done">Workflow</li>
            <li className="is-active">Live decisions</li>
          </ol>
          <div className="zdec-run-phase">
            <p className="studio-kicker">{preview.name}</p>
            <h1>Run live decisions</h1>
            <p className="studio-lead">
              Enter case facts, then run the agents. Wave opens a dedicated report page and will not
              invent ALLOW outcomes or IPO figures.
            </p>
            <DecisionLiveRun
              config={preview.config}
              slug={savedSlug}
              title={preview.name}
              purpose={preview.purpose}
              backHref="/decision-agents/create"
            />
            <button type="button" className="run-back" onClick={() => setPhase("workflow")}>
              Back to workflow
            </button>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
