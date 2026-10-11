"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import WorkflowEditorCanvas from "@/components/agents/workflow-builder/WorkflowEditorCanvas";
import WorkflowValidationBar from "@/components/agents/workflow-builder/WorkflowValidationBar";
import type { AgentInterpretation } from "@/lib/agents/builder-types";
import { interpretationToDraftInput } from "@/lib/agents/save-builder-agent-draft";
import { generateWorkflowFromInterpretation } from "@/lib/agents/workflow/generate-from-interpretation";
import { buildFallbackInterpretation } from "@/lib/agents/interpret-agent-request";
import type {
  AgentWorkflowGraph,
  AgentWorkflowState,
  WorkflowSafetyDiff,
  WorkflowValidationResult,
} from "@/lib/agents/workflow/types";
import { readJsonResponse } from "@/lib/ux/fetch-json";
import { FLOW_ERRORS, FLOW_LOADING } from "@/lib/ux/flow-copy";
import BuilderClarifyPanel from "@/components/agents/workflow-builder/BuilderClarifyPanel";
import AgentRuntimeConsole from "@/components/agents/runtime/AgentRuntimeConsole";
import AgentLiveRunPanel, {
  pollLatestRunSteps,
  type LiveRunStep,
} from "@/components/agents/runtime/AgentLiveRunPanel";
import { getAgentRequirements } from "@/lib/agents/requirements/engine";
import { snapshotFromLiveDraft } from "@/lib/agents/requirements/from-agent";
import {
  asSetupAnswers,
  type AgentRequirement,
  type RequirementChoices,
} from "@/lib/agents/requirements/types";
import { matchWorkflowNodeToStep } from "@/lib/agents/workflow/run-status";
import type { RunAgentResult } from "@/lib/agents/runtime/types";

const MIN_PROMPT_LENGTH = 15;
const CLARIFY_ASK_TYPES = new Set(["choice", "email", "phone", "schedule"]);

function hasBlockingClarifyQuestions(requirements: AgentRequirement[] | undefined): boolean {
  return Boolean(
    requirements?.some(
      (item) =>
        item.required &&
        item.status === "missing" &&
        CLARIFY_ASK_TYPES.has(item.configurationType)
    )
  );
}

export default function VisualAgentBuilder() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const routeSlug = typeof params.agentId === "string" ? params.agentId.trim() : "";
  const editSlug = searchParams.get("agent")?.trim() || routeSlug;
  const idea = searchParams.get("idea")?.trim() ?? "";

  const [prompt, setPrompt] = useState(idea);
  const [nlEdit, setNlEdit] = useState("");
  const [loading, setLoading] = useState(Boolean(editSlug));
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [safetyReviewing, setSafetyReviewing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [agentSlug, setAgentSlug] = useState<string | null>(editSlug || null);
  const [agentDbId, setAgentDbId] = useState<string | null>(null);
  const [interpretation, setInterpretation] = useState<AgentInterpretation | null>(null);
  const [workflowGraph, setWorkflowGraph] = useState<AgentWorkflowGraph | null>(null);
  const [workflowState, setWorkflowState] = useState<AgentWorkflowState | null>(null);
  const [validation, setValidation] = useState<WorkflowValidationResult | null>(null);
  const [safetyDiff, setSafetyDiff] = useState<WorkflowSafetyDiff | null>(null);
  const [requirementChoices, setRequirementChoices] = useState<RequirementChoices>({});
  const [destinationEmail, setDestinationEmail] = useState<string | null>(null);
  const [destinationPhone, setDestinationPhone] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState(false);
  const [liveSteps, setLiveSteps] = useState<LiveRunStep[]>([]);
  const [liveRunning, setLiveRunning] = useState(false);
  const [liveResult, setLiveResult] = useState<RunAgentResult | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  const saveTimer = useRef<number | null>(null);

  const persistWorkflow = useCallback(
    async (graph: AgentWorkflowGraph, slug: string) => {
      setSaving(true);
      try {
        const response = await fetch(`/api/v1/agents/${encodeURIComponent(slug)}/workflow`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            graph,
            displayName: interpretation?.displayName,
            suggestedThreshold: interpretation?.suggestedThreshold,
          }),
        });
        const payload = await readJsonResponse<{
          success?: boolean;
          graph?: AgentWorkflowGraph;
          state?: AgentWorkflowState;
          validation?: WorkflowValidationResult;
          safetyDiff?: WorkflowSafetyDiff;
          error?: string;
        }>(response);

        if (!response.ok || !payload.graph) {
          throw new Error(payload.error ?? "Could not save workflow.");
        }

        setWorkflowGraph(payload.graph);
        setWorkflowState(payload.state ?? null);
        setValidation(payload.validation ?? null);
        setSafetyDiff(payload.safetyDiff ?? null);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save workflow.");
        return false;
      } finally {
        setSaving(false);
        setDirty(false);
      }
    },
    [interpretation]
  );

  const commitAgent = useCallback(
    async (nextInterpretation: AgentInterpretation, graph: AgentWorkflowGraph) => {
      const saveRes = await fetch("/api/v1/agents/save-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentDbId: agentDbId ?? undefined,
          ...interpretationToDraftInput(nextInterpretation, agentDbId ?? undefined),
          status: "draft",
          deliveryMode: nextInterpretation.deliveryMode,
          destinationEmail,
        }),
      });

      const savePayload = await readJsonResponse<{
        slug?: string;
        agentDbId?: string;
        error?: string;
      }>(saveRes);

      if (!saveRes.ok || !savePayload.slug) {
        throw new Error(savePayload.error ?? "Could not save your agent.");
      }

      setAgentSlug(savePayload.slug);
      setAgentDbId(savePayload.agentDbId ?? null);
      const saved = await persistWorkflow(graph, savePayload.slug);
      if (!saved) throw new Error("Could not save workflow.");

      const answers = asSetupAnswers(requirementChoices);
      if (
        savePayload.slug &&
        (destinationEmail ||
          destinationPhone ||
          requirementChoices.output ||
          Object.keys(answers).length > 0)
      ) {
        await fetch(`/api/v1/agents/${encodeURIComponent(savePayload.slug)}/requirements`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            answers,
            outputChoice: requirementChoices.output,
            destinationEmail,
            destinationPhone,
          }),
        });
      }

      setPendingCreate(false);
      return savePayload.slug;
    },
    [agentDbId, destinationEmail, destinationPhone, persistWorkflow, requirementChoices]
  );

  const queueSave = useCallback(
    (graph: AgentWorkflowGraph) => {
      if (!agentSlug) return;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void persistWorkflow(graph, agentSlug);
      }, 700);
    },
    [agentSlug, persistWorkflow]
  );

  const handleWorkflowChange = (graph: AgentWorkflowGraph) => {
    setWorkflowGraph(graph);
    setDirty(true);
    queueSave(graph);
  };

  const loadExistingAgent = useCallback(async (slug: string) => {
    setLoading(true);
    setError(null);
    try {
      const [agentRes, workflowRes, reqRes] = await Promise.all([
        fetch(`/api/v1/agents/${encodeURIComponent(slug)}`),
        fetch(`/api/v1/agents/${encodeURIComponent(slug)}/workflow`),
        fetch(`/api/v1/agents/${encodeURIComponent(slug)}/requirements?stage=setup`),
      ]);

      if (agentRes.status === 404) {
        return;
      }

      const agentPayload = await readJsonResponse<{
        agent?: {
          id: string;
          slug: string;
          name: string;
          goal: string;
          description: string;
          instructions: string;
          tools?: string[];
          triggerType?: AgentInterpretation["triggerType"];
          timezone?: string;
          schedule?: AgentInterpretation["schedule"];
          suggestedThreshold?: number;
          delivery?: { mode?: AgentInterpretation["deliveryMode"] };
        };
        error?: string;
      }>(agentRes);

      const workflowPayload = await readJsonResponse<{
        graph?: AgentWorkflowGraph;
        state?: AgentWorkflowState;
        agentDbId?: string;
        error?: string;
      }>(workflowRes);

      const reqPayload = await readJsonResponse<{
        missing?: AgentRequirement[];
      }>(reqRes);

      if (!agentRes.ok || !agentPayload.agent) {
        throw new Error(agentPayload.error ?? "Agent not found.");
      }

      const loaded = agentPayload.agent;
      setAgentSlug(loaded.slug);
      setAgentDbId(loaded.id);
      setPrompt(loaded.goal || loaded.description);
      setWorkflowGraph(workflowPayload.graph ?? null);
      setWorkflowState(workflowPayload.state ?? null);
      setInterpretation({
        displayName: loaded.name,
        goal: loaded.goal || loaded.description,
        instructions: loaded.instructions || loaded.goal || "",
        scheduleSummary: "When you run it",
        schedule: loaded.schedule ?? { when: "manual", triggerType: loaded.triggerType ?? "webhook" },
        timezone: loaded.timezone ?? "UTC",
        capabilityIds: [],
        capabilities: [],
        tools: loaded.tools ?? [],
        protectionSummary: "Wave Protection enabled",
        triggerType: loaded.triggerType ?? "webhook",
        suggestedThreshold: loaded.suggestedThreshold ?? 5000,
        originalDescription: loaded.goal || loaded.description,
        deliveryMode: loaded.delivery?.mode ?? "notification",
      });
      const askMissing = (reqPayload.missing ?? []).filter((item) =>
        ["choice", "email", "phone", "schedule"].includes(item.configurationType)
      );
      setPendingCreate(askMissing.length > 0);
      if (workflowPayload.graph) {
        await fetch(`/api/v1/agents/${encodeURIComponent(loaded.slug)}/workflow`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ graph: workflowPayload.graph }),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load agent.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (editSlug) {
      void loadExistingAgent(editSlug);
    }
  }, [editSlug, loadExistingAgent]);

  const generateFromPrompt = async (description: string) => {
    if (description.trim().length < MIN_PROMPT_LENGTH) return;

    setGenerating(true);
    setError(null);

    try {
      let nextInterpretation: AgentInterpretation | null = null;
      try {
        const interpretRes = await fetch("/api/v1/agents/interpret", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: description.trim() }),
        });
        const interpretPayload = await readJsonResponse<{
          interpretation?: AgentInterpretation;
          error?: string;
        }>(interpretRes);
        if (interpretRes.ok && interpretPayload.interpretation) {
          nextInterpretation = interpretPayload.interpretation;
        }
      } catch {
        nextInterpretation = null;
      }

      if (!nextInterpretation) {
        nextInterpretation = buildFallbackInterpretation(description.trim());
      }

      setInterpretation(nextInterpretation);

      const graph = generateWorkflowFromInterpretation(nextInterpretation);
      setWorkflowGraph(graph);

      const preview = getAgentRequirements(
        snapshotFromLiveDraft({
          interpretation: nextInterpretation,
          workflow: graph,
          requirementChoices,
          destinationEmail,
          destinationPhone,
        })
      );
      const needsAnswers = hasBlockingClarifyQuestions(preview.requirements);
      if (needsAnswers) {
        setPendingCreate(true);
        return;
      }

      await commitAgent(nextInterpretation, graph);
    } catch (err) {
      setError(err instanceof Error ? err.message : FLOW_ERRORS.createAgent);
    } finally {
      setGenerating(false);
    }
  };

  const applyNaturalLanguageEdit = async () => {
    const addition = nlEdit.trim();
    if (!addition || !prompt.trim()) return;
    const merged = `${prompt.trim()}\n\nAlso: ${addition}`;
    setPrompt(merged);
    setNlEdit("");
    await generateFromPrompt(merged);
  };

  const liveRequirements =
    interpretation && workflowGraph
      ? getAgentRequirements(
          snapshotFromLiveDraft({
            agentId: agentSlug ?? undefined,
            interpretation,
            workflow: workflowGraph,
            requirementChoices,
            destinationEmail,
            destinationPhone,
          })
        )
      : null;

  const handleClarifyAnswer = (requirement: AgentRequirement, value: string) => {
    setRequirementChoices((current) => {
      const next: RequirementChoices = {
        ...current,
        [requirement.key]: value,
      };
      if (requirement.key === "output_destination") {
        next.output = value as RequirementChoices["output"];
      }
      if (requirement.key === "customer_source") {
        next.customerSource = value as RequirementChoices["customerSource"];
      }
      return next;
    });
    if (requirement.key === "output_destination") {
      setInterpretation((current) =>
        current
          ? {
              ...current,
              deliveryMode:
                value === "email" ? "email" : value === "whatsapp" ? "whatsapp" : "notification",
            }
          : current
      );
    }
    if (requirement.configurationType === "email") setDestinationEmail(value);
    if (requirement.configurationType === "phone") setDestinationPhone(value);
    if (requirement.configurationType === "schedule") {
      try {
        const parsed = JSON.parse(value) as { when?: string; time?: string; timezone?: string };
        setInterpretation((current) =>
          current
            ? {
                ...current,
                triggerType: "schedule",
                timezone: parsed.timezone ?? current.timezone,
                schedule: {
                  ...current.schedule,
                  when: (parsed.when as AgentInterpretation["schedule"]["when"]) ?? "daily",
                  time: parsed.time,
                  triggerType: "schedule",
                },
              }
            : current
        );
      } catch {
        /* ignore */
      }
    }
  };

  const handleClarifyContinue = async () => {
    if (!interpretation || !workflowGraph) return;
    setGenerating(true);
    setError(null);
    try {
      await commitAgent(interpretation, workflowGraph);
    } catch (err) {
      setError(err instanceof Error ? err.message : FLOW_ERRORS.createAgent);
    } finally {
      setGenerating(false);
    }
  };

  const ensureSavedSlug = async (): Promise<string | null> => {
    if (agentSlug) return agentSlug;
    if (!interpretation || !workflowGraph) {
      setError("Generate the workflow first.");
      return null;
    }
    if (hasBlockingClarifyQuestions(liveRequirements?.requirements)) {
      setError("Answer the questions on the left so Wave can create this agent, then try again.");
      return null;
    }
    return commitAgent(interpretation, workflowGraph);
  };

  const handleVerify = async () => {
    setVerifying(true);
    setError(null);
    try {
      const slug = await ensureSavedSlug();
      if (!slug) return;
      const response = await fetch(
        `/api/v1/agents/${encodeURIComponent(slug)}/workflow/verify`,
        { method: "POST" }
      );
      const payload = await readJsonResponse<{
        validation?: WorkflowValidationResult;
        safetyDiff?: WorkflowSafetyDiff;
        state?: AgentWorkflowState;
        error?: string;
      }>(response);
      if (!response.ok) throw new Error(payload.error ?? "Verification failed.");
      setValidation(payload.validation ?? null);
      setSafetyDiff(payload.safetyDiff ?? null);
      setWorkflowState(payload.state ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setVerifying(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    setError(null);
    try {
      const slug = await ensureSavedSlug();
      if (!slug) return;
      const response = await fetch(
        `/api/v1/agents/${encodeURIComponent(slug)}/workflow/publish`,
        { method: "POST" }
      );
      const payload = await readJsonResponse<{ slug?: string; error?: string }>(response);
      if (!response.ok || !payload.slug) {
        throw new Error(payload.error ?? "Could not publish agent.");
      }
      router.push(`/agents/${encodeURIComponent(payload.slug)}/prepare`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish agent.");
    } finally {
      setPublishing(false);
    }
  };

  const handleSafetyReview = async () => {
    setSafetyReviewing(true);
    setError(null);
    try {
      const slug = await ensureSavedSlug();
      if (!slug) return;
      const response = await fetch(
        `/api/v1/agents/${encodeURIComponent(slug)}/workflow/review`,
        { method: "POST" }
      );
      const payload = await readJsonResponse<{ state?: AgentWorkflowState; error?: string }>(
        response
      );
      if (!response.ok) throw new Error(payload.error ?? "Could not record safety review.");
      setWorkflowState(payload.state ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record safety review.");
    } finally {
      setSafetyReviewing(false);
    }
  };

  const handleDiscardDraft = async () => {
    if (!agentSlug) return;
    const response = await fetch(
      `/api/v1/agents/${encodeURIComponent(agentSlug)}/workflow`,
      { method: "DELETE" }
    );
    const payload = await readJsonResponse<{ state?: AgentWorkflowState; error?: string }>(
      response
    );
    if (!response.ok) {
      setError(payload.error ?? "Could not discard draft.");
      return;
    }
    setWorkflowState(payload.state ?? null);
    if (payload.state?.published) {
      setWorkflowGraph(payload.state.published);
    }
  };

  if (loading) {
    return (
      <p className="wfb-loading">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        Loading agent builder…
      </p>
    );
  }

  return (
    <>
      <div className="wfb-builder">
        <section className="wfb-panel wfb-panel-left" aria-label="Agent builder">
          <h1 className="wfb-title">Agent Builder</h1>
          <p className="wfb-lead">What do you want your agent to do?</p>

          <label className="wfb-prompt-field" htmlFor="wfb-prompt">
            <textarea
              id="wfb-prompt"
              className="wfb-prompt ds-input"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Create an agent that finds the latest AI news every morning, summarizes the top 5 stories, and emails me."
              rows={8}
              disabled={generating}
            />
          </label>

          <button
            type="button"
            className="wfb-btn wfb-btn-primary wfb-generate-btn"
            disabled={generating || prompt.trim().length < MIN_PROMPT_LENGTH}
            onClick={() => void generateFromPrompt(prompt)}
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {FLOW_LOADING.interpretingAgent}
              </>
            ) : (
              "Generate workflow"
            )}
          </button>

          {pendingCreate && liveRequirements ? (
            <BuilderClarifyPanel
              result={liveRequirements}
              onAnswer={handleClarifyAnswer}
              onContinue={() => void handleClarifyContinue()}
              continuing={generating}
            />
          ) : null}

          {workflowGraph ? (
            <div className="wfb-nl-edit">
              <p className="wfb-nl-label">Refine in plain language</p>
              <textarea
                className="ds-input"
                rows={2}
                value={nlEdit}
                onChange={(event) => setNlEdit(event.target.value)}
                placeholder='e.g. "Also send the summary to Slack"'
              />
              <button
                type="button"
                className="wfb-btn wfb-btn-secondary"
                disabled={!nlEdit.trim() || generating}
                onClick={() => void applyNaturalLanguageEdit()}
              >
                Update from prompt
              </button>
              <p className="wfb-nl-note">
                Natural-language edits re-run interpretation and regenerate the workflow while
                keeping your agent draft.
              </p>
            </div>
          ) : null}

          {interpretation ? (
            <div className="wfb-plan ds-panel">
              <h2>Auto-generated plan</h2>
              <p>{interpretation.goal}</p>
              <ul>
                {interpretation.capabilities.map((capability) => (
                  <li key={capability.id}>{capability.label}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <p className="wfb-error" role="alert">
              {error}
            </p>
          ) : null}

          {saving ? <p className="wfb-saving">Saving draft…</p> : null}
        </section>

        <section className="wfb-panel wfb-panel-right" aria-label="Workflow canvas">
          <div className="wfb-panel-right-header">
            <h2>Workflow</h2>
            {workflowState?.draft ? (
              <span className="wfb-draft-badge">Draft changes</span>
            ) : null}
            {dirty ? <span className="wfb-draft-badge">Unsaved</span> : null}
          </div>

          <WorkflowEditorCanvas
            graph={workflowGraph}
            onChange={handleWorkflowChange}
            agentSlug={agentSlug}
            runStatuses={
              workflowGraph
                ? Object.fromEntries(
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
                  )
                : undefined
            }
          />

          <WorkflowValidationBar
            validation={validation}
            safetyDiff={safetyDiff}
            hasDraft={Boolean(workflowState?.draft)}
            unsaved={dirty}
            verifying={verifying}
            publishing={publishing}
            reviewing={safetyReviewing}
            safetyReviewedAt={workflowState?.safetyReviewedAt ?? null}
            onVerify={() => void handleVerify()}
            onSaveDraft={() => {
              void (async () => {
                if (!workflowGraph) return;
                const slug = await ensureSavedSlug();
                if (slug) await persistWorkflow(workflowGraph, slug);
              })();
            }}
            onDiscard={() => void handleDiscardDraft()}
            onPublish={() => void handlePublish()}
            onSafetyReview={() => void handleSafetyReview()}
          />
        </section>
      </div>

      {agentSlug ? (
        <div className="wfb-runtime">
          <section className="wfb-panel" aria-label="What this agent needs">
            <h2>What your agent needs</h2>
            {liveRequirements ? (
              <ul className="wfb-req-list">
                {liveRequirements.requirements
                  .filter((item) => item.required)
                  .slice(0, 8)
                  .map((item) => (
                    <li key={item.key}>
                      {item.status === "ready" ? "✓" : "⚠"} {item.label}
                    </li>
                  ))}
              </ul>
            ) : null}
            <a className="wfb-btn wfb-btn-secondary" href={`/agents/${encodeURIComponent(agentSlug)}/prepare`}>
              Configure
            </a>
          </section>

          <section className="wfb-panel" aria-label="Test your agent">
            <h2>Test your agent</h2>
            <button
              type="button"
              className="wfb-btn wfb-btn-primary"
              disabled={liveRunning}
              onClick={() => {
                void (async () => {
                  const req = await fetch(
                    `/api/v1/agents/${encodeURIComponent(agentSlug)}/requirements?stage=test`
                  );
                  const payload = (await req.json()) as { ready?: boolean };
                  if (!payload.ready) {
                    router.push(`/agents/${encodeURIComponent(agentSlug)}/prepare`);
                    return;
                  }
                  setLiveRunning(true);
                  setLiveError(null);
                  setLiveResult(null);
                  const poll = window.setInterval(() => {
                    void pollLatestRunSteps(agentSlug).then(setLiveSteps);
                  }, 900);
                  try {
                    const response = await fetch(
                      `/api/v1/agents/${encodeURIComponent(agentSlug)}/run`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          task: interpretation?.goal || prompt || "Run a live test of this agent.",
                          mode: "test",
                        }),
                      }
                    );
                    const body = (await response.json()) as {
                      result?: RunAgentResult;
                      error?: string;
                      preparePath?: string;
                    };
                    if (response.status === 409 && body.preparePath) {
                      router.push(body.preparePath);
                      return;
                    }
                    if (!response.ok || !body.result) {
                      throw new Error(body.error ?? "Live test failed.");
                    }
                    setLiveResult(body.result);
                    setLiveSteps(
                      (body.result.steps ?? []).map((step) => ({
                        key: step.key,
                        label: step.label,
                        detail: step.detail,
                        status: step.status,
                      }))
                    );
                  } catch (err) {
                    setLiveError(err instanceof Error ? err.message : "Live test failed.");
                  } finally {
                    window.clearInterval(poll);
                    setLiveRunning(false);
                  }
                })();
              }}
            >
              Run live test
            </button>
            <AgentLiveRunPanel
              running={liveRunning}
              steps={liveSteps}
              result={liveResult}
              error={liveError}
              onRetry={() => setLiveResult(null)}
            />
          </section>

          <AgentRuntimeConsole
            agentSlug={agentSlug}
            onSteps={setLiveSteps}
          />

          <section className="wfb-panel wfb-actions-row">
            <a className="wfb-btn wfb-btn-secondary" href={`/agents/${encodeURIComponent(agentSlug)}/safety`}>
              Protect
            </a>
            <a className="wfb-btn wfb-btn-secondary" href={`/agents/${encodeURIComponent(agentSlug)}/deploy`}>
              Deploy
            </a>
          </section>
        </div>
      ) : null}
    </>
  );
}
