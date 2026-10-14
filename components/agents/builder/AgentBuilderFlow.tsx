"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Shield,
  Sparkles,
} from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import {
  BUILDER_CAPABILITY_OPTIONS,
  capabilityIdsToTools,
  type BuilderCapabilityId,
} from "@/lib/agents/builder-capabilities";
import {
  BUILDER_SCHEDULE_OPTIONS,
  BUILDER_WIZARD_STEPS,
  type AgentInterpretation,
  type BuilderScheduleChoice,
  type BuilderWizardStep,
} from "@/lib/agents/builder-types";
import type { AgentDeliveryMode } from "@/lib/agents/delivery/types";
import { deliveryModeLabel } from "@/lib/agents/delivery/infer-delivery";
import type { AgentScheduleConfig } from "@/lib/agents/runtime-types";
import { AGENT_TEST_TOOLS } from "@/lib/agents/evaluate-agent-test";
import type { AgentTestEvaluation } from "@/lib/agents/evaluate-agent-test";
import { saveCreatedAgentSession } from "@/lib/agent-builder/created-agent-session";
import { saveAgentConfigFromCreate } from "@/lib/agents/load-agent-setup-config";
import { saveAgentLifecycle } from "@/lib/agent-builder/agent-lifecycle";
import { createStandaloneLifecyclePatch } from "@/lib/agents/agent-mode";
import { labelAgentTool } from "@/lib/agents/tool-labels";
import { FLOW_ERRORS, FLOW_LOADING } from "@/lib/ux/flow-copy";

const EXAMPLE_REQUEST =
  "Every morning, find interesting posts from AI founders on X and prepare thoughtful replies.";

const MIN_CHARS = 15;
const MAX_CHARS = 500;

function stepIndex(step: BuilderWizardStep): number {
  return BUILDER_WIZARD_STEPS.findIndex((item) => item.id === step);
}

function scheduleChoiceFromConfig(schedule: AgentScheduleConfig): BuilderScheduleChoice {
  if (schedule.when === "weekly") return "weekly";
  if (schedule.when === "on_event") return "on_event";
  if (schedule.when === "at_time") return "at_time";
  if (schedule.when === "daily") return "daily";
  return "manual";
}

function buildScheduleFromChoice(
  choice: BuilderScheduleChoice,
  time: string
): { schedule: AgentScheduleConfig; summary: string; triggerType: AgentInterpretation["triggerType"] } {
  switch (choice) {
    case "daily":
      return {
        schedule: { when: "daily", time: "09:00", triggerType: "schedule" },
        summary: "Every day at 9:00 AM",
        triggerType: "schedule",
      };
    case "at_time":
      return {
        schedule: { when: "at_time", time, triggerType: "schedule" },
        summary: `At ${formatDisplayTime(time)} each day`,
        triggerType: "schedule",
      };
    case "weekly":
      return {
        schedule: { when: "weekly", days: ["monday", "wednesday", "friday"], triggerType: "schedule" },
        summary: "Weekly on Monday, Wednesday, and Friday",
        triggerType: "schedule",
      };
    case "on_event":
      return {
        schedule: { when: "on_event", triggerType: "email" },
        summary: "When something happens",
        triggerType: "email",
      };
    default:
      return {
        schedule: { when: "manual", triggerType: "webhook" },
        summary: "When you ask it to run",
        triggerType: "webhook",
      };
  }
}

function formatDisplayTime(time24: string): string {
  const [hourPart, minutePart] = time24.split(":");
  const hours = Number(hourPart);
  const minutes = Number(minutePart);
  const meridiem = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${meridiem}`;
}

function pickTestTool(capabilityIds: BuilderCapabilityId[]) {
  const toolOrder: BuilderCapabilityId[] = [
    "refunds",
    "email",
    "web_search",
    "http",
    "files",
    "whatsapp",
    "crm",
    "database",
    "calendar",
    "x",
  ];

  for (const capabilityId of toolOrder) {
    if (!capabilityIds.includes(capabilityId)) continue;
    const option = BUILDER_CAPABILITY_OPTIONS.find((item) => item.id === capabilityId);
    const toolName = option?.tools[0];
    if (!toolName) continue;
    const testTool = AGENT_TEST_TOOLS.find((tool) => tool.toolName === toolName);
    if (testTool) return testTool;
  }

  return AGENT_TEST_TOOLS[0];
}

export default function AgentBuilderFlow() {
  const [step, setStep] = useState<BuilderWizardStep>("describe");
  const [description, setDescription] = useState("");
  const [interpretation, setInterpretation] = useState<AgentInterpretation | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [goal, setGoal] = useState("");
  const [scheduleSummary, setScheduleSummary] = useState("");
  const [capabilityIds, setCapabilityIds] = useState<BuilderCapabilityId[]>([]);
  const [scheduleChoice, setScheduleChoice] = useState<BuilderScheduleChoice>("daily");
  const [dailyTime, setDailyTime] = useState("09:00");
  const [timezone, setTimezone] = useState("UTC");
  const [deliveryMode, setDeliveryMode] = useState<AgentDeliveryMode>("notification");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [suggestedThreshold, setSuggestedThreshold] = useState(5000);

  const [agentDbId, setAgentDbId] = useState<string | null>(null);
  const [agentSlug, setAgentSlug] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<AgentTestEvaluation | null>(null);
  const [published, setPublished] = useState(false);

  const trimmedDescription = description.trim();
  const currentStepIndex = stepIndex(step);

  const scheduleConfig = useMemo(
    () => buildScheduleFromChoice(scheduleChoice, dailyTime),
    [scheduleChoice, dailyTime]
  );

  const testTool = useMemo(() => pickTestTool(capabilityIds), [capabilityIds]);

  const toggleCapability = (id: BuilderCapabilityId) => {
    setCapabilityIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  const handleInterpret = async () => {
    if (trimmedDescription.length < MIN_CHARS) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/v1/agents/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: trimmedDescription }),
      });

      const payload = (await response.json()) as {
        success?: boolean;
        interpretation?: AgentInterpretation;
        error?: string;
      };

      if (!response.ok || !payload.interpretation) {
        throw new Error(payload.error ?? FLOW_ERRORS.createAgent);
      }

      const next = payload.interpretation;
      setInterpretation(next);
      setDisplayName(next.displayName);
      setGoal(next.goal);
      setScheduleSummary(next.scheduleSummary);
      setCapabilityIds(next.capabilityIds);
      setInstructions(next.instructions);
      setSuggestedThreshold(next.suggestedThreshold);
      setTimezone(next.timezone);
      setDeliveryMode(next.deliveryMode ?? "notification");
      setScheduleChoice(scheduleChoiceFromConfig(next.schedule));
      if (next.schedule.time) {
        setDailyTime(next.schedule.time);
      }
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : FLOW_ERRORS.createAgent);
    } finally {
      setLoading(false);
    }
  };

  const saveDraft = useCallback(
    async (status?: "draft" | "testing") => {
      const schedule = scheduleConfig.schedule;

      const response = await fetch("/api/v1/agents/save-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentDbId: agentDbId ?? undefined,
          displayName,
          goal,
          instructions,
          scheduleSummary: scheduleConfig.summary,
          schedule,
          timezone,
          capabilityIds,
          tools: capabilityIdsToTools(capabilityIds),
          triggerType: scheduleConfig.triggerType,
          suggestedThreshold,
          status,
          deliveryMode,
        }),
      });

      const payload = (await response.json()) as {
        success?: boolean;
        agentDbId?: string;
        slug?: string;
        apiKey?: string;
        keyPrefix?: string;
        error?: string;
      };

      if (!response.ok || !payload.agentDbId || !payload.slug) {
        throw new Error(payload.error ?? FLOW_ERRORS.createAgent);
      }

      setAgentDbId(payload.agentDbId);
      setAgentSlug(payload.slug);

      if (payload.apiKey) {
        saveCreatedAgentSession({
          agentId: payload.slug,
          plainKey: payload.apiKey,
          keyPrefix: payload.keyPrefix ?? "",
          spec: {
            name: displayName,
            agentId: payload.slug,
            summary: goal,
            purpose: goal,
            tools: capabilityIdsToTools(capabilityIds).map((toolName) => ({
              id: toolName,
              label: labelAgentTool(toolName),
              icon: "tool",
              toolName,
              actionType: toolName,
            })),
            protection: [],
            generatedAt: new Date().toISOString(),
            source: "fallback",
          },
          createdAt: new Date().toISOString(),
        });
      }

      saveAgentConfigFromCreate({
        agentId: payload.slug,
        name: displayName,
        description: goal,
        purpose: goal,
        triggerType: scheduleConfig.triggerType,
        tools: capabilityIdsToTools(capabilityIds),
        suggestedThreshold,
      });

      saveAgentLifecycle(payload.slug, {
        ...createStandaloneLifecyclePatch(),
        actionsConfigured: true,
      });

      return payload;
    },
    [
      agentDbId,
      capabilityIds,
      displayName,
      goal,
      instructions,
      scheduleConfig,
      suggestedThreshold,
      timezone,
      deliveryMode,
    ]
  );

  const handleContinueFromReview = async () => {
    setLoading(true);
    setError(null);
    try {
      await saveDraft("draft");
      setStep("capabilities");
    } catch (err) {
      setError(err instanceof Error ? err.message : FLOW_ERRORS.createAgent);
    } finally {
      setLoading(false);
    }
  };

  const handleContinueFromCapabilities = async () => {
    if (capabilityIds.length === 0) {
      setError("Pick at least one thing your agent can use.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await saveDraft("draft");
      setStep("schedule");
    } catch (err) {
      setError(err instanceof Error ? err.message : FLOW_ERRORS.createAgent);
    } finally {
      setLoading(false);
    }
  };

  const handleContinueFromSchedule = async () => {
    setLoading(true);
    setError(null);
    try {
      await saveDraft("testing");
      setStep("test");
    } catch (err) {
      setError(err instanceof Error ? err.message : FLOW_ERRORS.createAgent);
    } finally {
      setLoading(false);
    }
  };

  const handleRunTest = async () => {
    if (!agentSlug || testRunning) return;

    setTestRunning(true);
    setError(null);
    setTestResult(null);

    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agentSlug)}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolName: testTool.id,
          payload: testTool.defaultPayload,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        result?: AgentTestEvaluation;
        error?: string;
      };

      if (!response.ok || !data.result) {
        throw new Error(
          response.status >= 500 ? FLOW_ERRORS.genericApi : FLOW_ERRORS.testAgent
        );
      }

      setTestResult(data.result);
    } catch (err) {
      setError(
        err instanceof Error && err.message === FLOW_ERRORS.genericApi
          ? FLOW_ERRORS.genericApi
          : FLOW_ERRORS.testAgent
      );
    } finally {
      setTestRunning(false);
    }
  };

  const handlePublish = async () => {
    if (!agentDbId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/v1/agents/publish-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentDbId }),
      });

      const payload = (await response.json()) as {
        success?: boolean;
        slug?: string;
        error?: string;
      };

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? FLOW_ERRORS.genericApi);
      }

      setPublished(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : FLOW_ERRORS.genericApi);
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    const prev = BUILDER_WIZARD_STEPS[currentStepIndex - 1];
    if (prev) setStep(prev.id);
  };

  return (
    <PageShell maxWidth="6xl" className="zab-page">
      <div className="zab-wrap fade-in-up">
        <header className="zab-header">
          <Link href="/integrations" className="zab-back">
            <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            My Agents
          </Link>
          <div className="zab-header-main">
            <div className="zab-header-icon" aria-hidden="true">
              <Bot className="h-7 w-7" strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="zab-title">Create Agent</h1>
              <p className="zab-subtitle">Describe what you want — Wave handles the rest</p>
            </div>
          </div>
        </header>

        <nav className="zab-progress" aria-label="Creation progress">
          <ol className="zab-progress-list">
            {BUILDER_WIZARD_STEPS.map((item, index) => {
              const done = index < currentStepIndex;
              const active = item.id === step;
              return (
                <li
                  key={item.id}
                  className={`zab-progress-item ${active ? "zab-progress-item-active" : ""} ${
                    done ? "zab-progress-item-done" : ""
                  }`}
                >
                  <span className="zab-progress-dot" aria-hidden="true">
                    {done ? <Check className="h-3 w-3" strokeWidth={2.5} /> : index + 1}
                  </span>
                  <span className="zab-progress-label">{item.label}</span>
                </li>
              );
            })}
          </ol>
        </nav>

        <article className="zab-card ds-panel">
          {step === "describe" ? (
            <>
              <div className="zab-step-icon" aria-hidden="true">
                <Sparkles className="h-6 w-6" strokeWidth={1.75} />
              </div>
              <h2 className="zab-step-title">What do you want your agent to do?</h2>
              <p className="zab-step-lead">
                Write it like you would explain to a colleague — no technical setup needed.
              </p>

              <label className="zab-field" htmlFor="zab-description">
                <textarea
                  id="zab-description"
                  className="zab-textarea ds-input"
                  rows={5}
                  maxLength={MAX_CHARS}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={EXAMPLE_REQUEST}
                  disabled={loading}
                />
              </label>

              <p className="zab-meta">
                {description.length} / {MAX_CHARS} characters
                {trimmedDescription.length > 0 && trimmedDescription.length < MIN_CHARS
                  ? ` · Add ${MIN_CHARS - trimmedDescription.length} more`
                  : null}
              </p>

              <button
                type="button"
                className="zab-example-btn"
                onClick={() => setDescription(EXAMPLE_REQUEST)}
                disabled={loading}
              >
                Try the example
              </button>
            </>
          ) : null}

          {step === "review" && interpretation ? (
            <>
              <h2 className="zab-step-title">Review your agent</h2>
              <p className="zab-step-lead">
                Wave interpreted your request. Edit anything before continuing.
              </p>

              <dl className="zab-review-grid">
                <div className="zab-review-item">
                  <dt>Agent Name</dt>
                  <dd>
                    <input
                      className="ds-input w-full"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                  </dd>
                </div>
                <div className="zab-review-item">
                  <dt>What it does</dt>
                  <dd>
                    <textarea
                      className="zab-textarea ds-input"
                      rows={3}
                      value={goal}
                      onChange={(event) => setGoal(event.target.value)}
                    />
                  </dd>
                </div>
                <div className="zab-review-item">
                  <dt>When it works</dt>
                  <dd>
                    <input
                      className="ds-input w-full"
                      value={scheduleSummary}
                      onChange={(event) => setScheduleSummary(event.target.value)}
                    />
                  </dd>
                </div>
                <div className="zab-review-item">
                  <dt>What it can use</dt>
                  <dd>{interpretation.capabilities.map((item) => item.label).join(", ")}</dd>
                </div>
                <div className="zab-review-item zab-review-protection">
                  <dt>
                    <Shield className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                    Protection
                  </dt>
                  <dd>{interpretation.protectionSummary}</dd>
                </div>
              </dl>

              <button
                type="button"
                className="zab-advanced-toggle"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((open) => !open)}
              >
                Advanced settings
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </button>

              {advancedOpen ? (
                <div className="zab-advanced-panel">
                  <label className="zab-field">
                    <span className="zab-label">Instructions for the agent</span>
                    <textarea
                      className="zab-textarea ds-input"
                      rows={4}
                      value={instructions}
                      onChange={(event) => setInstructions(event.target.value)}
                    />
                  </label>
                </div>
              ) : null}
            </>
          ) : null}

          {step === "capabilities" ? (
            <>
              <h2 className="zab-step-title">What can your agent use?</h2>
              <p className="zab-step-lead">Pick the apps and services your agent needs.</p>

              <ul className="zab-cap-grid">
                {BUILDER_CAPABILITY_OPTIONS.map((option) => {
                  const selected = capabilityIds.includes(option.id);
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        className={`zab-cap-btn ${selected ? "zab-cap-btn-selected" : ""}`}
                        aria-pressed={selected}
                        onClick={() => toggleCapability(option.id)}
                      >
                        <span className="zab-cap-label">{option.label}</span>
                        <span className="zab-cap-desc">{option.description}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}

          {step === "schedule" ? (
            <>
              <h2 className="zab-step-title">When should your agent work?</h2>
              <p className="zab-step-lead">Choose when Wave should run this agent for you.</p>

              <ul className="zab-schedule-grid">
                {BUILDER_SCHEDULE_OPTIONS.map((option) => {
                  const selected = scheduleChoice === option.id;
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        className={`zab-schedule-btn ${selected ? "zab-schedule-btn-selected" : ""}`}
                        aria-pressed={selected}
                        onClick={() => setScheduleChoice(option.id)}
                      >
                        <Calendar className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                        <span>
                          <span className="zab-cap-label">{option.label}</span>
                          <span className="zab-cap-desc">{option.description}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {scheduleChoice === "at_time" ? (
                <label className="zab-field zab-time-field">
                  <span className="zab-label">Time</span>
                  <input
                    type="time"
                    className="ds-input"
                    value={dailyTime}
                    onChange={(event) => setDailyTime(event.target.value)}
                  />
                </label>
              ) : null}

              <p className="zab-schedule-preview">
                <strong>Preview:</strong> {scheduleConfig.summary}
              </p>

              <div className="zab-delivery-section">
                <h3 className="zab-label">How should Wave deliver the result?</h3>
                <ul className="zab-schedule-grid">
                  {(
                    [
                      ["email", "Email me"],
                      ["notification", "Wave notification"],
                      ["both", "Email and WhatsApp"],
                    ] as const
                  ).map(([mode, label]) => (
                    <li key={mode}>
                      <button
                        type="button"
                        className={`zab-schedule-btn ${deliveryMode === mode ? "zab-schedule-btn-selected" : ""}`}
                        aria-pressed={deliveryMode === mode}
                        onClick={() => setDeliveryMode(mode)}
                      >
                        <span className="zab-cap-label">{label}</span>
                        <span className="zab-cap-desc">{deliveryModeLabel(mode)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}

          {step === "test" ? (
            <>
              <h2 className="zab-step-title">Test your agent</h2>
              <p className="zab-step-lead">
                Send a sample action and see how Wave Protection responds — no setup required.
              </p>

              <div className="zab-test-card">
                <p className="zab-test-action-label">Sample action</p>
                <p className="zab-test-action-value">{labelAgentTool(testTool.toolName)}</p>
                <p className="zab-test-hint">
                  Wave will evaluate this action using your protection settings.
                </p>

                {!testResult ? (
                  <button
                    type="button"
                    className="zab-btn zab-btn-primary"
                    disabled={testRunning}
                    onClick={() => void handleRunTest()}
                  >
                    {testRunning ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        {FLOW_LOADING.testingAgent}
                      </>
                    ) : (
                      "Run sample test"
                    )}
                  </button>
                ) : (
                  <div className={`zab-test-result zab-test-result-${testResult.decision.toLowerCase()}`}>
                    <CheckCircle2 className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                    <div>
                      <p className="zab-test-result-title">{testResult.decisionSummary}</p>
                      <p className="zab-test-result-detail">{testResult.reason}</p>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : null}

          {step === "publish" ? (
            <>
              <h2 className="zab-step-title">
                {published ? "Your agent is live" : "Publish your agent"}
              </h2>
              <p className="zab-step-lead">
                {published
                  ? "Wave saved your agent and it is ready to use."
                  : "Everything looks good. Publish when you are ready."}
              </p>

              <dl className="zab-summary">
                <div>
                  <dt>Agent Name</dt>
                  <dd>{displayName}</dd>
                </div>
                <div>
                  <dt>What it does</dt>
                  <dd>{goal}</dd>
                </div>
                <div>
                  <dt>When it works</dt>
                  <dd>{scheduleConfig.summary}</dd>
                </div>
                <div>
                  <dt>What it can use</dt>
                  <dd>
                    {capabilityIds
                      .map((id) => BUILDER_CAPABILITY_OPTIONS.find((item) => item.id === id)?.label)
                      .filter(Boolean)
                      .join(", ")}
                  </dd>
                </div>
                <div>
                  <dt>Protection</dt>
                  <dd>Wave checks important actions before they happen.</dd>
                </div>
              </dl>

              {published ? (
                <div className="zab-published-actions">
                  <Link href="/integrations" className="zab-btn zab-btn-primary">
                    View My Agents
                    <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  </Link>
                  {agentSlug ? (
                    <Link
                      href={`/agents/${encodeURIComponent(agentSlug)}/workspace`}
                      className="zab-btn zab-btn-secondary"
                    >
                      Open agent workspace
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}

          {error ? (
            <p className="zab-error" role="alert">
              {error}
            </p>
          ) : null}

          {!published ? (
            <div className="zab-actions">
              {step !== "describe" ? (
                <button type="button" className="zab-btn zab-btn-secondary" onClick={goBack}>
                  Back
                </button>
              ) : (
                <Link href="/integrations" className="zab-btn zab-btn-secondary">
                  Cancel
                </Link>
              )}

              {step === "describe" ? (
                <button
                  type="button"
                  className="zab-btn zab-btn-primary"
                  disabled={loading || trimmedDescription.length < MIN_CHARS}
                  onClick={() => void handleInterpret()}
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Understanding your request...
                    </>
                  ) : (
                    <>
                      Continue
                      <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                    </>
                  )}
                </button>
              ) : null}

              {step === "review" ? (
                <button
                  type="button"
                  className="zab-btn zab-btn-primary"
                  disabled={loading || !displayName.trim() || !goal.trim()}
                  onClick={() => void handleContinueFromReview()}
                >
                  {loading ? FLOW_LOADING.creatingAgent : "Continue to capabilities"}
                  <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                </button>
              ) : null}

              {step === "capabilities" ? (
                <button
                  type="button"
                  className="zab-btn zab-btn-primary"
                  disabled={loading || capabilityIds.length === 0}
                  onClick={() => void handleContinueFromCapabilities()}
                >
                  Continue to schedule
                  <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                </button>
              ) : null}

              {step === "schedule" ? (
                <button
                  type="button"
                  className="zab-btn zab-btn-primary"
                  disabled={loading}
                  onClick={() => void handleContinueFromSchedule()}
                >
                  Continue to test
                  <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                </button>
              ) : null}

              {step === "test" ? (
                <button
                  type="button"
                  className="zab-btn zab-btn-primary"
                  disabled={!testResult}
                  onClick={() => setStep("publish")}
                >
                  Continue to publish
                  <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                </button>
              ) : null}

              {step === "publish" ? (
                <button
                  type="button"
                  className="zab-btn zab-btn-primary"
                  disabled={loading || !agentDbId}
                  onClick={() => void handlePublish()}
                >
                  {loading ? "Publishing..." : "Publish agent"}
                  <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : null}
        </article>
      </div>
    </PageShell>
  );
}
