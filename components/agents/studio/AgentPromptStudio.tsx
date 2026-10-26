"use client";

import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import BuilderClarifyPanel from "@/components/agents/workflow-builder/BuilderClarifyPanel";
import type { AgentInterpretation } from "@/lib/agents/builder-types";
import type { AgentRequirement, AgentRequirementsResult } from "@/lib/agents/requirements/types";
import { FLOW_LOADING } from "@/lib/ux/flow-copy";

const MIN_PROMPT_LENGTH = 15;

const EXAMPLES = [
  "Find the latest AI news every morning, summarize the top 5 stories, and notify me in Wave.",
  "Read my uploaded CSV of support tickets and flag rows that are missing evidence.",
  "Search the web for competitor pricing once a week and draft a short briefing.",
];

const PROCESS_STEPS = [
  "Reading your prompt",
  "Planning the workflow",
  "Choosing tools",
  "Checking what we still need",
];

export type PromptStudioPhase = "prompt" | "processing" | "questions" | "continue";

interface AgentPromptStudioProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  phase: PromptStudioPhase;
  processStep: number;
  generating: boolean;
  error: string | null;
  interpretation: AgentInterpretation | null;
  requirements: AgentRequirementsResult | null;
  nodeCount: number;
  onGenerate: () => void;
  onAnswer: (requirement: AgentRequirement, value: string) => void;
  onContinueClarify: () => void;
  onOpenWorkflow: () => void;
}

export default function AgentPromptStudio({
  prompt,
  onPromptChange,
  phase,
  processStep,
  generating,
  error,
  interpretation,
  requirements,
  nodeCount,
  onGenerate,
  onAnswer,
  onContinueClarify,
  onOpenWorkflow,
}: AgentPromptStudioProps) {
  const tooShort = prompt.trim().length < MIN_PROMPT_LENGTH;

  return (
    <div className="studio-prompt">
      <div className="studio-prompt-glow" aria-hidden="true" />
      <header className="studio-stepper" aria-label="Create agent steps">
        <span className="is-active">1. Prompt</span>
        <span>2. Workflow</span>
        <span>3. Prepare</span>
      </header>

      {phase === "prompt" || phase === "processing" ? (
        <div className="studio-prompt-stage">
          <p className="studio-kicker">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            New agent
          </p>
          <h1>Describe what this agent should do</h1>
          <p className="studio-lead">
            Write the outcome in plain language. Wave will design an editable workflow from it —
            no nodes until you confirm.
          </p>

          <label className="studio-prompt-field" htmlFor="studio-prompt">
            <span className="sr-only">Agent prompt</span>
            <textarea
              id="studio-prompt"
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !tooShort) {
                  event.preventDefault();
                  onGenerate();
                }
              }}
              placeholder="Create an agent that finds the latest AI news every morning, summarizes the top 5 stories, and notifies me in Wave."
              rows={8}
              disabled={generating}
            />
          </label>

          <div className="studio-examples" aria-label="Example prompts">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                disabled={generating}
                onClick={() => onPromptChange(example)}
              >
                {example}
              </button>
            ))}
          </div>

          <div className="studio-actions">
          <button
            type="button"
            className="studio-primary"
            disabled={generating || tooShort}
            onClick={onGenerate}
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {FLOW_LOADING.interpretingAgent}
              </>
            ) : (
              <>
                Generate workflow
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </button>
          <p className="studio-hint">Press Ctrl + Enter to generate · at least 15 characters</p>
          </div>

          {phase === "processing" ? (
            <ol className="studio-process" aria-live="polite">
              {PROCESS_STEPS.map((label, index) => (
                <li
                  key={label}
                  className={
                    index < processStep ? "is-done" : index === processStep ? "is-current" : ""
                  }
                >
                  <span />
                  {label}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}

      {phase === "questions" && requirements ? (
        <div className="studio-prompt-stage studio-prompt-stage-narrow">
          <p className="studio-kicker">Almost ready</p>
          <h1>A few details before the workflow</h1>
          <p className="studio-lead">
            {interpretation?.goal ?? "Wave understood the agent. Answer only what this workflow needs."}
          </p>
          <BuilderClarifyPanel
            result={requirements}
            onAnswer={onAnswer}
            onContinue={onContinueClarify}
            continuing={generating}
            continueLabel="Create agent and continue"
          />
        </div>
      ) : null}

      {phase === "continue" && interpretation ? (
        <div className="studio-prompt-stage studio-continue">
          <p className="studio-kicker">Workflow ready</p>
          <h1>{interpretation.displayName}</h1>
          <p className="studio-lead">{interpretation.goal}</p>
          <ul className="studio-continue-meta">
            <li>{nodeCount} workflow nodes</li>
            <li>{interpretation.tools.length} tools</li>
            <li>{interpretation.scheduleSummary}</li>
          </ul>
          <button
            type="button"
            className="studio-primary studio-primary-lg"
            disabled={nodeCount === 0}
            onClick={onOpenWorkflow}
          >
            Open workflow
            <ArrowRight className="h-5 w-5 studio-arrow-nudge" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="studio-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
