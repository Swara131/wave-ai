"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Bot,
  CheckCircle2,
  Loader2,
  Pause,
  Play,
  Settings,
  Shield,
  XCircle,
} from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import StatusBadge from "@/components/ui/StatusBadge";
import Tabs from "@/components/ui/Tabs";
import Skeleton from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import type { PendingApproval } from "@/lib/approval-types";
import AgentResultRenderer from "@/components/agents/results/AgentResultRenderer";
import { previewPlainText } from "@/lib/agents/results/parse-agent-result";
import type { AgentDeliveryMode } from "@/lib/agents/delivery/types";
import { deliveryModeLabel } from "@/lib/agents/delivery/infer-delivery";
import { deriveExecutableTestTask } from "@/lib/agents/runtime/model/task-intent";
import { formatScheduleTimeLabel } from "@/lib/agents/scheduling/format-next-run";
import { normalizeTime24 } from "@/lib/agents/scheduling/time-input";
import { ScheduleTimePicker } from "@/components/agents/ScheduleTimePicker";
import AgentWorkflowCanvas from "@/components/agents/workspace/AgentWorkflowCanvas";
import { buildWorkflowFromAgent } from "@/lib/agents/workflow-nodes";

interface AgentPayload {
  id: string;
  slug: string;
  name: string;
  description: string;
  goal?: string | null;
  instructions?: string | null;
  tools: string[];
  capabilities?: Array<{ id: string; label: string }>;
  capabilityLabels?: string[];
  schedule?: { when?: string; time?: string; summary?: string };
  scheduleSummary?: string | null;
  nextRunAt?: string | null;
  nextRunAtLabel?: string | null;
  timezone?: string;
  status: string;
  displayStatus?: "active" | "paused";
  requiresWebSearch?: boolean;
  webSearchConnected?: boolean;
  delivery?: { mode: AgentDeliveryMode; destinationEmail?: string | null };
  deliveryLabel?: string;
  emailDeliveryConnected?: boolean;
  emailDeliverySandbox?: boolean;
  emailDeliverySandboxRecipient?: string | null;
  userEmail?: string | null;
}

interface AgentRunStep {
  id: string;
  label: string;
  detail?: string | null;
  status: string;
  sequence: number;
}

interface AgentRun {
  id: string;
  status: string;
  mode: string;
  summary?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  steps: AgentRunStep[];
  delivery?: {
    status?: string;
    mode?: string;
    destination?: string | null;
    error?: string | null;
  } | null;
}

type Tab =
  | "overview"
  | "workflow"
  | "tools"
  | "connections"
  | "runs"
  | "safety"
  | "approvals"
  | "settings";

interface RunApiResult {
  runId?: string | null;
  status?: string;
  summary?: string | null;
  error?: string | null;
  delivery?: AgentRun["delivery"];
  steps?: Array<{
    key: string;
    label: string;
    detail?: string | null;
    status?: string;
  }>;
}

function mapRunResultToAgentRun(result: RunApiResult, mode: string): AgentRun {
  const createdAt = new Date().toISOString();
  return {
    id: result.runId ?? `local-${Date.now()}`,
    status: result.status ?? "failed",
    mode,
    summary: result.summary ?? null,
    errorMessage: result.error ?? null,
    finishedAt: createdAt,
    createdAt,
    delivery: result.delivery ?? null,
    steps: (result.steps ?? []).map((step, index) => ({
      id: `${step.key}-${index}`,
      label: step.label,
      detail: step.detail ?? null,
      status: step.status ?? "completed",
      sequence: index + 1,
    })),
  };
}

function runStatusLabel(status: string): string {
  switch (status) {
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "timeout":
      return "Timed out";
    case "running":
      return "Running";
    case "awaiting_approval":
      return "Awaiting approval";
    default:
      return status;
  }
}

function runStatusClass(status: string): string {
  switch (status) {
    case "completed":
      return "zagent-run-status-completed";
    case "failed":
    case "timeout":
      return "zagent-run-status-failed";
    case "awaiting_approval":
      return "zagent-run-status-review";
    default:
      return "zagent-run-status-running";
  }
}

function RunStatusIcon({ status }: { status: string }) {
  if (status === "completed") {
    return <CheckCircle2 className="h-4 w-4" aria-hidden="true" />;
  }
  if (status === "failed" || status === "timeout") {
    return <XCircle className="h-4 w-4" aria-hidden="true" />;
  }
  return <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />;
}

export default function ZeltaAgentHubPage() {
  const params = useParams();
  const slug = typeof params.agentId === "string" ? params.agentId.trim() : "";
  const [tab, setTab] = useState<Tab>("overview");
  const [agent, setAgent] = useState<AgentPayload | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [deliveryMode, setDeliveryMode] = useState<AgentDeliveryMode>("notification");
  const [destinationEmail, setDestinationEmail] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [timezone, setTimezone] = useState("UTC");

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      const [agentRes, runsRes, approvalsRes] = await Promise.all([
        fetch(`/api/v1/agents/${encodeURIComponent(slug)}`),
        fetch(`/api/v1/agents/runs/${encodeURIComponent(slug)}?limit=20`),
        fetch("/api/approvals"),
      ]);

      if (!agentRes.ok) {
        throw new Error("Agent not found.");
      }

      const agentPayload = (await agentRes.json()) as { agent: AgentPayload };
      setAgent(agentPayload.agent);
      setDeliveryMode(agentPayload.agent.delivery?.mode ?? "notification");
      setDestinationEmail(
        agentPayload.agent.delivery?.destinationEmail ?? agentPayload.agent.userEmail ?? ""
      );
      setScheduleTime(
        normalizeTime24(agentPayload.agent.schedule?.time) ?? "09:00"
      );
      setTimezone(agentPayload.agent.timezone ?? "UTC");

      if (runsRes.ok) {
        const runsPayload = (await runsRes.json()) as {
          runs?: AgentRun[];
          persistenceEnabled?: boolean;
          warning?: string;
        };
        setRuns(runsPayload.runs ?? []);
        setPersistenceWarning(
          runsPayload.persistenceEnabled === false
            ? runsPayload.warning ??
                "Run history requires the agent runtime database migration."
            : null
        );
      } else {
        setRuns([]);
        setPersistenceWarning(null);
      }

      if (approvalsRes.ok) {
        const approvalPayload = (await approvalsRes.json()) as {
          approvals?: PendingApproval[];
        };
        setApprovals(
          (approvalPayload.approvals ?? []).filter(
            (item) =>
              item.agentId === slug || item.agentId === agentPayload.agent.slug
          )
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const latestRun = runs[0] ?? null;

  const capabilityLabels = useMemo(() => {
    if (!agent) return [];
    if (agent.capabilityLabels?.length) return agent.capabilityLabels;
    if (agent.capabilities?.length) {
      return agent.capabilities.map((item) => item.label);
    }
    return [];
  }, [agent]);

  const isActive =
    agent?.displayStatus === "active" ||
    agent?.status === "published" ||
    agent?.status === "active" ||
    agent?.status === "testing";

  const handleRunNow = async () => {
    if (!slug || !agent || running) return;
    setRunning(true);
    setRunError(null);
    try {
      const task = deriveExecutableTestTask(agent.goal, agent.description);
      const response = await fetch(`/api/v1/agents/run/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, mode: "manual" }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        result?: RunApiResult;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Run failed.");
      }

      if (
        payload.result?.status === "failed" ||
        payload.result?.status === "timeout" ||
        payload.success === false
      ) {
        setRunError(payload.result?.error ?? payload.error ?? "Run failed.");
      }

      if (payload.result) {
        const mappedRun = mapRunResultToAgentRun(payload.result, "manual");
        setRuns((current) => {
          if (payload.result?.runId && current.some((run) => run.id === mappedRun.id)) {
            return current;
          }
          return [mappedRun, ...current.filter((run) => run.id !== mappedRun.id)];
        });
      }

      const runsRes = await fetch(
        `/api/v1/agents/runs/${encodeURIComponent(slug)}?limit=20`
      );
      if (runsRes.ok) {
        const runsPayload = (await runsRes.json()) as {
          runs?: AgentRun[];
          persistenceEnabled?: boolean;
          warning?: string;
        };
        if ((runsPayload.runs ?? []).length > 0) {
          setRuns(runsPayload.runs ?? []);
        }
        setPersistenceWarning(
          runsPayload.persistenceEnabled === false
            ? runsPayload.warning ??
                "Run history requires the agent runtime database migration."
            : null
        );
      }
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Could not run agent.");
    } finally {
      setRunning(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!slug || settingsSaving) return;
    setSettingsSaving(true);
    setSettingsMessage(null);
    try {
      const response = await fetch(
        `/api/v1/agents/settings/${encodeURIComponent(slug)}`,
        {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveryMode,
          destinationEmail: destinationEmail.trim() || null,
          schedule: {
            when: "daily",
            time: normalizeTime24(scheduleTime) ?? scheduleTime,
            triggerType: "schedule",
          },
          scheduleSummary: `Every day at ${formatScheduleTimeLabel(scheduleTime, timezone)}`,
          timezone,
        }),
      }
      );
      const { parseApiJsonResponse } = await import("@/lib/agents/api/parse-api-response");
      const payload = await parseApiJsonResponse<{
        success?: boolean;
        error?: string;
        deliveryWarning?: string | null;
        agent?: {
          nextRunAtLabel?: string | null;
          schedulePaused?: boolean;
          emailDeliverySandbox?: boolean;
          emailDeliverySandboxRecipient?: string | null;
        };
      }>(response);
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error ?? "Could not save settings.");
      }
      const nextLabel = payload.agent?.nextRunAtLabel;
      const warningSuffix = payload.deliveryWarning ? ` Warning: ${payload.deliveryWarning}` : "";
      if (payload.agent?.schedulePaused && nextLabel) {
        setSettingsMessage(
          `Settings saved. Agent is paused — will run at ${nextLabel} once activated.${warningSuffix}`
        );
      } else if (nextLabel) {
        setSettingsMessage(`Settings saved. Next run: ${nextLabel}.${warningSuffix}`);
      } else {
        setSettingsMessage(`Settings saved.${warningSuffix}`);
      }
      await load();
    } catch (err) {
      setSettingsMessage(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleTogglePause = async () => {
    if (!slug || !agent || statusUpdating) return;
    setStatusUpdating(true);
    setError(null);
    try {
      const nextStatus = isActive ? "paused" : "active";
      const response = await fetch(`/api/v1/agents/status/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        agent?: { status?: string };
      };
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error ?? "Could not update agent status.");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update agent status.");
    } finally {
      setStatusUpdating(false);
    }
  };

  if (!slug) {
    return (
      <PageShell maxWidth="6xl">
        <p>Agent not found.</p>
      </PageShell>
    );
  }

  if (loading) {
    return (
      <PageShell maxWidth="6xl" className="zagent-page">
        <Skeleton lines={4} />
      </PageShell>
    );
  }

  if (error || !agent) {
    return (
      <PageShell maxWidth="6xl" className="zagent-page">
        <ErrorState
          title="Wave couldn't load this agent."
          description="The agent may have been removed, or the connection timed out."
          fixLabel="Back to Home"
          fixHref="/dashboard"
          technical={error}
        />
      </PageShell>
    );
  }

  return (
    <PageShell maxWidth="6xl" className="zagent-page">
      <header className="zagent-header">
        <div className="zagent-header-main">
          <span className="zagent-icon" aria-hidden="true">
            <Bot strokeWidth={1.75} />
          </span>
          <div>
            <h1 className="ds-page-title">{agent.name}</h1>
            <p className="ds-page-description">{agent.description}</p>
            <p className="zagent-status">
              <StatusBadge tone={isActive ? "success" : "neutral"}>
                {isActive ? "Active" : "Paused"}
              </StatusBadge>
              {latestRun ? (
                <span className="zagent-meta-inline">
                  Last run {new Date(latestRun.finishedAt ?? latestRun.createdAt).toLocaleString()}
                </span>
              ) : (
                <span className="zagent-meta-inline">No runs yet</span>
              )}
            </p>
          </div>
        </div>
        <div className="zagent-header-actions">
          <button
            type="button"
            className="ds-btn ds-btn-primary"
            disabled={running || !isActive}
            onClick={() => void handleRunNow()}
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4" aria-hidden="true" />
            )}
            Run now
          </button>
          <Link href={`/agents/${encodeURIComponent(slug)}/test`} className="ds-btn ds-btn-secondary">
            Test Agent
          </Link>
          <Link href={`/agents/${encodeURIComponent(slug)}/verify`} className="ds-btn ds-btn-secondary">
            Verify Agent
          </Link>
          <Link href={`/agents/${encodeURIComponent(slug)}/deploy`} className="ds-btn ds-btn-secondary">
            Deploy Agent
          </Link>
          <Link href={`/agents/${encodeURIComponent(slug)}/safety`} className="ds-btn ds-btn-secondary">
            <Shield className="h-4 w-4" aria-hidden="true" />
            Safety
          </Link>
          <Link href={`/agents/${encodeURIComponent(slug)}/edit`} className="ds-btn ds-btn-ghost">
            Edit workflow
          </Link>
          <button
            type="button"
            className="ds-btn ds-btn-secondary"
            disabled={statusUpdating}
            onClick={() => void handleTogglePause()}
          >
            {statusUpdating ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : isActive ? (
              <Pause className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4" aria-hidden="true" />
            )}
            {isActive ? "Pause" : "Resume"}
          </button>
        </div>
      </header>

      {agent.requiresWebSearch && !agent.webSearchConnected ? (
        <p className="zagent-run-message ds-panel" role="alert">
          Web Search is required for this agent but is not connected. Add{" "}
          <code>TAVILY_API_KEY</code> in Settings → Integrations.
        </p>
      ) : null}

      {persistenceWarning ? (
        <p className="zagent-run-message ds-panel" role="status">
          {persistenceWarning}
        </p>
      ) : null}

      {runError ? (
        <p className="zagent-run-message ds-panel zagent-run-error" role="alert">
          {runError}
        </p>
      ) : null}

      <Tabs
        items={[
          { id: "overview", label: "Overview" },
          { id: "workflow", label: "Workflow" },
          { id: "tools", label: "Tools" },
          { id: "connections", label: "Connections" },
          { id: "runs", label: "Runs" },
          { id: "safety", label: "Safety" },
          { id: "approvals", label: "Approvals" },
          { id: "settings", label: "Notifications" },
        ]}
        value={tab}
        onChange={(id) => setTab(id as Tab)}
      />

      {tab === "overview" ? (
        <section className="zagent-overview ds-panel">
          <h2 className="zagent-overview-subhead">What it does</h2>
          <p>{agent.instructions ?? agent.description}</p>
          <dl className="zagent-facts">
            <div>
              <dt>Capabilities</dt>
              <dd>{capabilityLabels.join(", ") || "General assistance"}</dd>
            </div>
            {agent.scheduleSummary ? (
              <div>
                <dt>Schedule</dt>
                <dd>{agent.scheduleSummary}</dd>
              </div>
            ) : null}
            {agent.deliveryLabel ? (
              <div>
                <dt>Delivery</dt>
                <dd>{agent.deliveryLabel}</dd>
              </div>
            ) : null}
            <div>
              <dt>Protection</dt>
              <dd>
                <Shield className="inline h-4 w-4" aria-hidden="true" /> Wave Protection
                enabled
              </dd>
            </div>
          </dl>

          {latestRun ? (
            <div className="zagent-latest-run">
              <h3>Latest run</h3>
              <p className={`zagent-run-status ${runStatusClass(latestRun.status)}`}>
                <RunStatusIcon status={latestRun.status} />
                {runStatusLabel(latestRun.status)}
                <time dateTime={latestRun.finishedAt ?? latestRun.createdAt}>
                  {new Date(latestRun.finishedAt ?? latestRun.createdAt).toLocaleString()}
                </time>
              </p>
              {latestRun.status === "completed" && latestRun.summary ? (
                <AgentResultRenderer result={latestRun.summary} status={latestRun.status} />
              ) : null}
              {latestRun.status === "failed" || latestRun.status === "timeout" ? (
                <AgentResultRenderer
                  status="failed"
                  error={latestRun.errorMessage ?? "This run failed."}
                />
              ) : null}
            </div>
          ) : (
            <p className="zagent-empty">No runs yet. Use Run now to execute your agent.</p>
          )}

          <div className="zagent-overview-actions">
            <Link
              href={`/agents/${encodeURIComponent(slug)}/workspace`}
              className="ds-btn ds-btn-secondary"
            >
              Open workspace
            </Link>
            <Link href="/agents/create" className="ds-btn ds-btn-ghost">
              Edit agent
            </Link>
          </div>
        </section>
      ) : null}

      {tab === "workflow" ? (
        <section className="zagent-overview ds-panel zagent-workflow-panel">
          <h2>Workflow</h2>
          <AgentWorkflowCanvas
            nodes={buildWorkflowFromAgent({
              name: agent.name,
              goal: agent.goal,
              instructions: agent.instructions,
              tools: agent.tools,
              capabilityLabels,
              scheduleSummary: agent.scheduleSummary,
              triggerType: agent.schedule?.when,
              deliveryLabel: agent.deliveryLabel,
              protected: true,
            })}
          />
        </section>
      ) : null}

      {tab === "tools" ? (
        <section className="zagent-overview ds-panel">
          <h2>Tools</h2>
          {agent.tools.length === 0 ? (
            <EmptyState
              icon={Bot}
              title="No tools connected"
              description="This agent does not use external tools yet."
            />
          ) : (
            <ul className="zagent-tool-list">
              {agent.tools.map((tool) => (
                <li key={tool}>{tool}</li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "connections" ? (
        <section className="zagent-overview ds-panel">
          <h2>Connections</h2>
          <dl className="zagent-facts">
            <div>
              <dt>Web search</dt>
              <dd>{agent.webSearchConnected ? "Connected" : "Not connected"}</dd>
            </div>
            <div>
              <dt>Email delivery</dt>
              <dd>{agent.emailDeliveryConnected ? "Connected" : "Not connected"}</dd>
            </div>
            <div>
              <dt>Delivery</dt>
              <dd>{agent.deliveryLabel ?? "Dashboard only"}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {tab === "safety" ? (
        <section className="zagent-overview ds-panel">
          <h2>Safety</h2>
          <p>Wave Protection is enabled for this agent. High-risk actions pause for approval.</p>
          <Link href={`/agents/${encodeURIComponent(slug)}/safety`} className="ds-btn ds-btn-secondary">
            Open safety settings
          </Link>
        </section>
      ) : null}

      {tab === "runs" ? (
        <section className="zagent-activity ds-panel">
          <h2>Runs</h2>
          {runs.length === 0 ? (
            <EmptyState
              icon={Play}
              title="No runs yet"
              description="Test this agent to see live execution steps here."
              primaryAction={{
                label: "Test Agent",
                href: `/agents/${encodeURIComponent(slug)}/test`,
              }}
            />
          ) : (
            <ul className="zagent-activity-list">
              {runs.map((run) => (
                <li key={run.id} className="zagent-activity-run">
                  <div className="zagent-activity-run-header">
                    <strong className={runStatusClass(run.status)}>
                      {runStatusLabel(run.status)}
                    </strong>
                    <span className="zagent-activity-mode">{run.mode}</span>
                    <time dateTime={run.finishedAt ?? run.createdAt}>
                      {new Date(run.finishedAt ?? run.createdAt).toLocaleString()}
                    </time>
                  </div>
                  {run.summary && run.status === "completed" ? (
                    <p className="zagent-activity-summary">
                      {previewPlainText(run.summary)}
                    </p>
                  ) : null}
                  {run.errorMessage &&
                  (run.status === "failed" || run.status === "timeout") ? (
                    <p className="zagent-run-error">{run.errorMessage}</p>
                  ) : null}
                  {run.delivery?.status === "failed" ? (
                    <p className="zagent-run-error">
                      Delivery failed: {run.delivery.error ?? "Could not deliver result."}
                    </p>
                  ) : null}
                  {run.steps.length > 0 ? (
                    <ol className="zagent-run-steps">
                      {run.steps.map((step) => (
                        <li
                          key={step.id}
                          className={`zagent-run-step zagent-run-step-${step.status}`}
                        >
                          <span className="zagent-run-step-label">{step.label}</span>
                          {step.detail ? (
                            <span className="zagent-run-step-detail">{step.detail}</span>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "approvals" ? (
        <section className="zagent-approvals ds-panel">
          <h2>Approvals</h2>
          {approvals.length === 0 ? (
            <p className="zagent-empty">No pending approvals for this agent.</p>
          ) : (
            <ul>
              {approvals.map((item) => (
                <li key={item.id}>
                  <Link href={`/approvals?proposal=${encodeURIComponent(item.id)}`}>
                    {item.aiExplanation || item.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "settings" ? (
        <section className="zagent-settings ds-panel">
          <h2>
            <Settings className="inline h-4 w-4" aria-hidden="true" /> Settings
          </h2>

          <div className="zagent-settings-group">
            <h3>Delivery</h3>
            {(deliveryMode === "email" || deliveryMode === "both") &&
            agent.emailDeliveryConnected === false ? (
              <p className="zagent-run-error" role="alert">
                Email delivery is not connected. Set RESEND_API_KEY and a verified RESEND_FROM_EMAIL in .env.local.
              </p>
            ) : null}
            <label className="zagent-field">
              <span>How should Wave deliver the result?</span>
              <select
                className="ds-input"
                value={deliveryMode}
                onChange={(event) =>
                  setDeliveryMode(event.target.value as AgentDeliveryMode)
                }
              >
                <option value="email">Email me</option>
                <option value="notification">Wave notification</option>
                <option value="both">Email and WhatsApp</option>
                <option value="none">None (dashboard only)</option>
              </select>
            </label>
            {(deliveryMode === "email" || deliveryMode === "both") ? (
              <>
                <label className="zagent-field">
                  <span>Destination email</span>
                  <input
                    type="email"
                    className="ds-input"
                    value={destinationEmail}
                    placeholder={agent.userEmail ?? "you@example.com"}
                    onChange={(event) => setDestinationEmail(event.target.value)}
                  />
                </label>
                {agent.emailDeliverySandbox &&
                agent.emailDeliverySandboxRecipient &&
                destinationEmail.trim().toLowerCase() !==
                  agent.emailDeliverySandboxRecipient.toLowerCase() ? (
                  <p className="zagent-run-error" role="alert">
                    Resend test mode only delivers to{" "}
                    <strong>{agent.emailDeliverySandboxRecipient}</strong>. Emails to other
                    addresses will fail until you verify a domain at resend.com/domains.
                  </p>
                ) : agent.emailDeliverySandbox && agent.emailDeliverySandboxRecipient ? (
                  <p className="zagent-hint">
                    Resend test mode: emails will be sent to{" "}
                    {agent.emailDeliverySandboxRecipient}.
                  </p>
                ) : null}
              </>
            ) : null}
            <p className="zagent-hint">{deliveryModeLabel(deliveryMode)}</p>
          </div>

          <div className="zagent-settings-group">
            <h3>Schedule</h3>
            <div className="zagent-field">
              <span>Every day at</span>
              <ScheduleTimePicker
                value24={scheduleTime}
                onChange24={setScheduleTime}
                timezone={timezone}
                disabled={settingsSaving}
              />
            </div>
            <label className="zagent-field">
              <span>Timezone</span>
              <input
                type="text"
                className="ds-input"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              />
            </label>
          </div>

          {settingsMessage ? <p className="zagent-hint">{settingsMessage}</p> : null}

          <div className="zagent-overview-actions">
            <button
              type="button"
              className="ds-btn ds-btn-primary"
              disabled={settingsSaving}
              onClick={() => void handleSaveSettings()}
            >
              {settingsSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Save settings
            </button>
            <Link
              href={`/agents/${encodeURIComponent(slug)}/test`}
              className="ds-btn ds-btn-secondary"
            >
              Test agent
            </Link>
          </div>
        </section>
      ) : null}
    </PageShell>
  );
}
