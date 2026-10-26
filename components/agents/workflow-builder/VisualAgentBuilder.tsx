"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
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
import { FLOW_ERRORS } from "@/lib/ux/flow-copy";
import AgentPromptStudio, {
  type PromptStudioPhase,
} from "@/components/agents/studio/AgentPromptStudio";
import AgentWorkflowStudio from "@/components/agents/studio/AgentWorkflowStudio";
import { type LiveRunStep } from "@/components/agents/runtime/AgentLiveRunPanel";
import { getAgentRequirements } from "@/lib/agents/requirements/engine";
import { snapshotFromLiveDraft } from "@/lib/agents/requirements/from-agent";
import {
  asSetupAnswers,
  type AgentRequirement,
  type RequirementChoices,
} from "@/lib/agents/requirements/types";

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

export default function VisualAgentBuilder({
  variant = "create",
}: {
  variant?: "create" | "workflow";
}) {
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
  const [liveSteps] = useState<LiveRunStep[]>([]);
  const [studioPhase, setStudioPhase] = useState<PromptStudioPhase>("prompt");
  const [processStep, setProcessStep] = useState(0);

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

  useEffect(() => {
    if (studioPhase !== "processing") return;
    if (processStep >= 3) return;
    const timer = window.setTimeout(() => {
      setProcessStep((index) => Math.min(index + 1, 3));
    }, 520);
    return () => window.clearTimeout(timer);
  }, [studioPhase, processStep]);

  const generateFromPrompt = async (description: string) => {
    if (description.trim().length < MIN_PROMPT_LENGTH) return;

    setGenerating(true);
    setError(null);
    if (variant === "create") {
      setStudioPhase("processing");
      setProcessStep(0);
    }

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
        if (variant === "create") setStudioPhase("questions");
        else setError("This change needs extra details. Return to the prompt step to answer them.");
        return;
      }

      await commitAgent(nextInterpretation, graph);
      if (variant === "create") setStudioPhase("continue");
    } catch (err) {
      setError(err instanceof Error ? err.message : FLOW_ERRORS.createAgent);
      if (variant === "create") setStudioPhase(pendingCreate ? "questions" : "prompt");
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
      if (variant === "create") setStudioPhase("continue");
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

  const handleConfirmWorkflow = async () => {
    setPublishing(true);
    setError(null);
    try {
      const slug = await ensureSavedSlug();
      if (!slug) return;
      if (workflowGraph) {
        const saved = await persistWorkflow(workflowGraph, slug);
        if (!saved) return;
      }
      router.push(`/agents/${encodeURIComponent(slug)}/prepare`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm workflow.");
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
      <p className="studio-loading">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        Loading…
      </p>
    );
  }

  if (variant === "create") {
    return (
      <AgentPromptStudio
        prompt={prompt}
        onPromptChange={setPrompt}
        phase={studioPhase}
        processStep={processStep}
        generating={generating}
        error={error}
        interpretation={interpretation}
        requirements={liveRequirements}
        nodeCount={workflowGraph?.nodes.length ?? 0}
        onGenerate={() => void generateFromPrompt(prompt)}
        onAnswer={handleClarifyAnswer}
        onContinueClarify={() => void handleClarifyContinue()}
        onOpenWorkflow={() => {
          if (!agentSlug) return;
          router.push(`/agents/${encodeURIComponent(agentSlug)}/workflow`);
        }}
      />
    );
  }

  return (
    <AgentWorkflowStudio
      agentSlug={agentSlug}
      interpretation={interpretation}
      workflowGraph={workflowGraph}
      workflowState={workflowState}
      validation={validation}
      safetyDiff={safetyDiff}
      dirty={dirty}
      saving={saving}
      verifying={verifying}
      publishing={publishing}
      safetyReviewing={safetyReviewing}
      error={error}
      liveSteps={liveSteps}
      nlEdit={nlEdit}
      onNlEditChange={setNlEdit}
      onApplyNlEdit={() => void applyNaturalLanguageEdit()}
      generating={generating}
      onWorkflowChange={handleWorkflowChange}
      onVerify={() => void handleVerify()}
      onSaveDraft={() => {
        void (async () => {
          if (!workflowGraph) return;
          const slug = await ensureSavedSlug();
          if (slug) await persistWorkflow(workflowGraph, slug);
        })();
      }}
      onDiscard={() => void handleDiscardDraft()}
      onConfirm={() => void handleConfirmWorkflow()}
      onSafetyReview={() => void handleSafetyReview()}
    />
  );
}
