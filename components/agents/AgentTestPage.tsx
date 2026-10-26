"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import AgentLiveRunPanel, {
  pollLatestRunSteps,
  type LiveRunStep,
} from "@/components/agents/runtime/AgentLiveRunPanel";
import AgentRuntimeConsole from "@/components/agents/runtime/AgentRuntimeConsole";
import { deriveExecutableTestTask } from "@/lib/agents/runtime/model/task-intent";
import type { RunAgentResult } from "@/lib/agents/runtime/types";
import { FLOW_ERRORS } from "@/lib/ux/flow-copy";

interface AgentSummary {
  name: string;
  description: string;
  goal?: string | null;
  status: string;
  slug?: string;
}

export default function AgentTestPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";

  const [agent, setAgent] = useState<AgentSummary | null>(null);
  const [task, setTask] = useState("");
  const [loadingAgent, setLoadingAgent] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunAgentResult | null>(null);
  const [steps, setSteps] = useState<LiveRunStep[]>([]);
  const [needsSetup, setNeedsSetup] = useState(false);

  const loadAgent = useCallback(async () => {
    if (!agentId) return;
    setLoadingAgent(true);
    setError(null);
    try {
      const [agentRes, reqRes] = await Promise.all([
        fetch(`/api/v1/agents/${encodeURIComponent(agentId)}`),
        fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/requirements?stage=test`),
      ]);
      const payload = (await agentRes.json()) as {
        agent?: AgentSummary;
        error?: string;
      };
      const reqPayload = (await reqRes.json()) as { ready?: boolean; error?: string };
      if (!agentRes.ok || !payload.agent) {
        throw new Error(payload.error ?? "Agent not found.");
      }
      setAgent(payload.agent);
      setTask(deriveExecutableTestTask(payload.agent.goal, payload.agent.description));
      if (!reqPayload.ready) {
        setNeedsSetup(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load agent.");
    } finally {
      setLoadingAgent(false);
    }
  }, [agentId]);

  useEffect(() => {
    void loadAgent();
  }, [loadAgent]);

  const handleRunTest = async () => {
    if (!agentId || running || task.trim().length < 3) return;
    if (needsSetup) {
      router.push(`/agents/${encodeURIComponent(agentId)}/prepare`);
      return;
    }

    setRunning(true);
    setError(null);
    setResult(null);
    const poll = window.setInterval(() => {
      void pollLatestRunSteps(agentId).then(setSteps);
    }, 900);

    try {
      const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: task.trim(), mode: "test" }),
      });

      const payload = (await response.json()) as {
        success?: boolean;
        result?: RunAgentResult;
        error?: string;
        preparePath?: string;
      };

      if (response.status === 409 && payload.preparePath) {
        router.push(payload.preparePath);
        return;
      }

      if (!response.ok || !payload.result) {
        throw new Error(payload.error ?? FLOW_ERRORS.testAgent);
      }

      setResult(payload.result);
      setSteps(
        (payload.result.steps ?? []).map((step) => ({
          key: step.key,
          label: step.label,
          detail: step.detail,
          status: step.status,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : FLOW_ERRORS.testAgent);
    } finally {
      window.clearInterval(poll);
      setRunning(false);
    }
  };

  const runTestRef = useRef(handleRunTest);
  runTestRef.current = handleRunTest;
  const autoRan = useRef(false);

  useEffect(() => {
    if (autoRan.current || loadingAgent || !agent || needsSetup || task.trim().length < 3) return;
    autoRan.current = true;
    void runTestRef.current();
  }, [agent, loadingAgent, needsSetup, task]);

  const hubHref = `/agents/${encodeURIComponent(agentId)}`;

  if (!agentId) {
    return (
      <PageShell maxWidth="6xl">
        <p>Agent not found.</p>
      </PageShell>
    );
  }

  if (loadingAgent) {
    return (
      <PageShell maxWidth="6xl" className="att-page">
        <div className="att-loading">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Loading agent…
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell maxWidth="6xl" className="att-page">
      <div className="att-layout fade-in-up">
        <header className="att-header">
          <Link href={hubHref} className="ag-back-link att-back">
            <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Back to agent
          </Link>
          <h1 className="att-title">Test your agent</h1>
          <p className="att-subtitle">
            This runs the real agent — the same one used by chat, voice, and schedule.
          </p>
          {agent ? <p className="att-agent-name">{agent.name}</p> : null}
        </header>

        {needsSetup ? (
          <section className="att-form asp-card">
            <p>Before we run your agent, let&apos;s configure what it needs.</p>
            <Link href={`/agents/${encodeURIComponent(agentId)}/prepare`} className="att-run-btn">
              Prepare agent
            </Link>
          </section>
        ) : (
          <section className="att-form asp-card" aria-labelledby="att-form-heading">
            <h2 id="att-form-heading" className="sr-only">
              Test form
            </h2>
            <label className="att-field">
              <span className="att-label">What should your agent do right now?</span>
              <textarea
                className="ds-input att-json"
                rows={4}
                value={task}
                disabled={running}
                onChange={(event) => {
                  setTask(event.target.value);
                  setError(null);
                }}
              />
            </label>
            {error ? (
              <p className="att-error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="button"
              className="att-run-btn"
              disabled={running || task.trim().length < 3}
              onClick={() => void handleRunTest()}
            >
              Run live test
            </button>
          </section>
        )}

        <AgentLiveRunPanel
          running={running}
          steps={steps}
          result={result}
          error={error}
          onRetry={() => {
            setResult(null);
            setError(null);
          }}
        />

        <AgentRuntimeConsole agentSlug={agentId} onSteps={setSteps} />
      </div>
    </PageShell>
  );
}
