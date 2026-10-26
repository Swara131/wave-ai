"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Braces,
  Check,
  CheckCircle2,
  Copy,
  Globe,
  Link2,
  Loader2,
  Terminal,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import Button from "@/components/ui/Button";
import CodeSnippetBlock from "@/components/onboarding/CodeSnippetBlock";
import AgentSetupCelebrationScreen from "@/components/onboarding/AgentSetupCelebrationScreen";
import type { AgentApiKeyRecord } from "@/lib/gateway/types";
import { loadCreatedAgentSession } from "@/lib/agent-builder/created-agent-session";
import { saveAgentLifecycle } from "@/lib/agent-builder/agent-lifecycle";
import type { SafetyCheckResult } from "@/lib/safety-check/evaluate-safety-check";
import {
  buildConnectionCodePlainText,
  buildConnectionCodeSegments,
  buildEnvExportSnippet,
  CONNECTION_TEST_TOOLS,
  formatSafetyDecision,
  getTechStackOption,
  mapPlatformToTechStack,
  TECH_STACK_OPTIONS,
  WIZARD_STEP_LABELS,
  type TechStackId,
} from "@/lib/onboarding/connection-setup-wizard";

type WizardStep = 1 | 2 | 3 | 4 | "complete";

const STACK_ICONS = {
  nodejs: Braces,
  python: Terminal,
  "custom-http": Globe,
  langchain: Link2,
} as const;

async function fetchAgentKeys(): Promise<AgentApiKeyRecord[]> {
  const response = await fetch("/api/gateway/keys");
  const payload = (await response.json()) as { keys?: AgentApiKeyRecord[]; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Failed to load agents.");
  return payload.keys ?? [];
}

function StepProgressBar({ step }: { step: WizardStep }) {
  const current = step === "complete" ? 5 : step;

  return (
    <ol className="csw-progress" aria-label="Setup progress">
      {WIZARD_STEP_LABELS.map((label, index) => {
        const stepNumber = index + 1;
        const done = current > stepNumber;
        const active = current === stepNumber;

        return (
          <li key={label} className="csw-progress-item">
            {index > 0 ? (
              <span className="csw-progress-arrow" aria-hidden="true">
                →
              </span>
            ) : null}
            <span
              className={`csw-progress-pill ${done ? "csw-progress-pill-done" : ""} ${active ? "csw-progress-pill-active" : ""}`}
            >
              <span className="csw-progress-marker" aria-hidden="true">
                {done ? "✓" : stepNumber}
              </span>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function CopyKeyBlock({ apiKey }: { apiKey: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="csw-key-block">
      <div className="csw-key-head">
        <span className="csw-key-label">API key</span>
        <button type="button" className="csw-code-copy" onClick={() => void handleCopy()}>
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" strokeWidth={2.5} />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={2} />
          )}
          {copied ? "✓ Copied!" : "Copy"}
        </button>
      </div>
      <pre className="csw-key-value">{apiKey}</pre>
    </div>
  );
}

export default function AgentConnectionSetupWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const agentParam = searchParams.get("agent")?.trim() ?? "";
  const platformParam = searchParams.get("platform");

  const [step, setStep] = useState<WizardStep>(1);
  const [techStack, setTechStack] = useState<TechStackId>(
    mapPlatformToTechStack(platformParam) ?? "nodejs"
  );
  const [codeTab, setCodeTab] = useState<TechStackId>(
    mapPlatformToTechStack(platformParam) ?? "nodejs"
  );
  const [keys, setKeys] = useState<AgentApiKeyRecord[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState(agentParam);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedToolId, setSelectedToolId] = useState(CONNECTION_TEST_TOOLS[0].id);
  const [payloadJson, setPayloadJson] = useState(CONNECTION_TEST_TOOLS[0].payloadTemplate);
  const [testStatus, setTestStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [testResult, setTestResult] = useState<SafetyCheckResult | null>(null);

  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  useEffect(() => {
    void fetchAgentKeys()
      .then((loaded) => {
        setKeys(loaded.filter((key) => !key.revokedAt));
        if (!agentParam && loaded.length === 1) {
          setSelectedAgentId(loaded[0].agentId);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load agents.");
      })
      .finally(() => setLoading(false));
  }, [agentParam]);

  const activeKey = useMemo(
    () => keys.find((key) => key.agentId === selectedAgentId) ?? null,
    [keys, selectedAgentId]
  );

  const session = useMemo(
    () => (selectedAgentId ? loadCreatedAgentSession(selectedAgentId) : null),
    [selectedAgentId]
  );

  const agentName =
    session?.spec?.name ?? activeKey?.name ?? selectedAgentId ?? "Your agent";

  const displayApiKey = useMemo(() => {
    if (session?.plainKey) return session.plainKey;
    if (activeKey?.keyPrefix) {
      return `${activeKey.keyPrefix}${"•".repeat(24)} (full key shown once at creation)`;
    }
    return "al_demo_key_placeholder_abc123def456";
  }, [session?.plainKey, activeKey?.keyPrefix]);

  const envSnippet = useMemo(
    () => buildEnvExportSnippet(session?.plainKey ?? displayApiKey.split(" ")[0]),
    [session?.plainKey, displayApiKey]
  );

  const snippetParams = useMemo(
    () => ({
      agentId: selectedAgentId || "your-agent-id",
      apiKeyPlaceholder: session?.plainKey ?? "YOUR_ZELTA_API_KEY",
      baseUrl,
    }),
    [selectedAgentId, session?.plainKey, baseUrl]
  );

  const codeSegments = useMemo(
    () => buildConnectionCodeSegments(codeTab, snippetParams),
    [codeTab, snippetParams]
  );

  const codePlainText = useMemo(
    () => buildConnectionCodePlainText(codeTab, snippetParams),
    [codeTab, snippetParams]
  );

  const selectedTool = useMemo(
    () => CONNECTION_TEST_TOOLS.find((tool) => tool.id === selectedToolId) ?? CONNECTION_TEST_TOOLS[0],
    [selectedToolId]
  );

  const handleToolChange = (toolId: string) => {
    const tool = CONNECTION_TEST_TOOLS.find((item) => item.id === toolId);
    if (!tool) return;
    setSelectedToolId(tool.id);
    setPayloadJson(tool.payloadTemplate);
    setTestStatus("idle");
    setTestResult(null);
  };

  const goBack = () => {
    if (step === "complete") {
      setStep(4);
      return;
    }
    if (step === 1) {
      router.push("/onboarding/connect");
      return;
    }
    setStep((current) => (typeof current === "number" ? ((current - 1) as WizardStep) : 4));
  };

  const runTest = async () => {
    if (!selectedAgentId || !activeKey) return;
    setTestStatus("loading");
    setError(null);
    setTestResult(null);

    try {
      JSON.parse(payloadJson);
    } catch {
      setTestStatus("error");
      setError("Sample payload must be valid JSON.");
      return;
    }

    try {
      const response = await fetch("/api/safety-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: selectedAgentId,
          agentName,
          actionId: selectedTool.actionId,
          customerId: "cus_connection_test",
          reason: selectedTool.reason,
          amountInr: selectedTool.amountInr ?? null,
        }),
      });

      const payload = (await response.json()) as {
        result?: SafetyCheckResult;
        error?: string;
      };

      if (!response.ok) throw new Error(payload.error ?? "Connection test failed.");

      setTestResult(payload.result ?? null);
      setTestStatus("success");
      saveAgentLifecycle(selectedAgentId, {
        connectionTestPassed: true,
        testActionPassed: true,
      });
    } catch (err) {
      setTestStatus("error");
      setError(err instanceof Error ? err.message : "Connection test failed.");
    }
  };

  const handleFinish = () => {
    if (selectedAgentId) {
      saveAgentLifecycle(selectedAgentId, {
        connectionAcknowledged: true,
        connectionTestPassed: testStatus === "success",
        testActionPassed: testStatus === "success",
      });
    }
    setStep("complete");
  };

  const stackLabel = getTechStackOption(techStack).shortLabel;

  const agentTools = useMemo(() => {
    if (session?.spec?.tools?.length) {
      return session.spec.tools.map((tool) => tool.toolName);
    }
    return [selectedTool.toolName];
  }, [session, selectedTool.toolName]);

  const dashboardHref = selectedAgentId
    ? `/agents/${encodeURIComponent(selectedAgentId)}/setup`
    : "/integrations";

  if (loading) {
    return (
      <PageShell maxWidth="6xl" className="csw-page">
        <div className="csw-loading">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Loading setup wizard…
        </div>
      </PageShell>
    );
  }

  if (!selectedAgentId && keys.length === 0) {
    return (
      <PageShell maxWidth="6xl" className="csw-page">
        <div className="csw-empty ds-panel">
          <Bot className="h-8 w-8 text-indigo-400" strokeWidth={2} aria-hidden="true" />
          <h1 className="csw-empty-title">Create an agent first</h1>
          <p className="csw-empty-desc">
            You need an agent and API key before connecting. Create one, then return here to finish
            setup.
          </p>
          <div className="csw-empty-actions">
            <Link href="/agents/build" className="ds-btn ds-btn-primary">
              Create agent
            </Link>
            <Link href="/integrations" className="ds-btn ds-btn-secondary">
              Open My Agents
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }

  if (step === "complete") {
    return (
      <AgentSetupCelebrationScreen
        agentName={agentName}
        techStack={stackLabel}
        tools={agentTools}
        dashboardHref={dashboardHref}
      />
    );
  }

  return (
    <PageShell maxWidth="6xl" className="csw-page">
      <div className="csw-layout fade-in-up">
        <aside className="csw-sidebar ds-panel">
          <p className="csw-sidebar-kicker">Connection setup</p>
          <p className="csw-sidebar-step">Step {step} of 4</p>

          {!selectedAgentId && keys.length > 1 ? (
            <label className="csw-sidebar-field">
              <span>Select agent</span>
              <select
                className="csw-select"
                value={selectedAgentId}
                onChange={(event) => setSelectedAgentId(event.target.value)}
              >
                <option value="">Choose…</option>
                {keys.map((key) => (
                  <option key={key.id} value={key.agentId}>
                    {key.name ?? key.agentId}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="csw-sidebar-meta">
              <span className="csw-sidebar-label">Agent</span>
              <strong>{agentName}</strong>
            </div>
          )}

          <div className="csw-sidebar-meta">
            <span className="csw-sidebar-label">Tech stack</span>
            <strong>{stackLabel}</strong>
          </div>

          <button type="button" className="csw-sidebar-back" onClick={goBack}>
            <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Back
          </button>
        </aside>

        <div className="csw-main">
          <StepProgressBar step={step} />

          {error ? (
            <p className="csw-error" role="alert">
              {error}
            </p>
          ) : null}

          {step === 1 ? (
            <section className="csw-panel ds-panel" aria-labelledby="csw-step1-title">
              <h1 id="csw-step1-title" className="csw-panel-title">
                What&apos;s your tech stack?
              </h1>
              <p className="csw-panel-desc">
                Pick the environment your agent runs in. We&apos;ll tailor code examples to match.
              </p>

              <div className="csw-stack-grid">
                {TECH_STACK_OPTIONS.map((option) => {
                  const Icon = STACK_ICONS[option.id];
                  const selected = techStack === option.id;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={`csw-stack-btn ${selected ? "csw-stack-btn-selected" : ""}`}
                      aria-pressed={selected}
                      onClick={() => {
                        setTechStack(option.id);
                        setCodeTab(option.id);
                      }}
                    >
                      <span className="csw-stack-icon" aria-hidden="true">
                        <Icon className="h-5 w-5" strokeWidth={2} />
                      </span>
                      <span className="csw-stack-body">
                        <span className="csw-stack-label-row">
                          <span className="csw-stack-label">{option.label}</span>
                          {option.popular ? (
                            <span className="csw-stack-badge">Most popular</span>
                          ) : null}
                        </span>
                        <span className="csw-stack-desc">{option.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="csw-panel-actions">
                <Button
                  variant="primary"
                  icon={ArrowRight}
                  disabled={!selectedAgentId && keys.length > 1}
                  onClick={() => setStep(2)}
                >
                  Next: Get your API key →
                </Button>
              </div>
            </section>
          ) : null}

          {step === 2 ? (
            <section className="csw-panel ds-panel" aria-labelledby="csw-step2-title">
              <h1 id="csw-step2-title" className="csw-panel-title">
                Copy your API key
              </h1>

              <div className="csw-once-warning" role="note">
                <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                <span>This key is shown only once. Save it now.</span>
              </div>

              <CopyKeyBlock apiKey={displayApiKey} />

              <p className="csw-panel-desc">
                Add this key to your environment variables:{" "}
                <code className="csw-inline-code">ZELTA_API_KEY</code>
              </p>

              <pre className="csw-env-example">{envSnippet}</pre>

              <div className="csw-panel-actions">
                <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button variant="primary" icon={ArrowRight} onClick={() => setStep(3)}>
                  Next: Add to your code →
                </Button>
              </div>
            </section>
          ) : null}

          {step === 3 ? (
            <section className="csw-panel ds-panel" aria-labelledby="csw-step3-title">
              <h1 id="csw-step3-title" className="csw-panel-title">
                Wire Wave into your code
              </h1>
              <p className="csw-panel-desc">
                Paste this into your agent code. Route every risky action through Wave before it
                executes.
              </p>

              <div className="csw-code-tabs" role="tablist" aria-label="Code language">
                {TECH_STACK_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="tab"
                    aria-selected={codeTab === option.id}
                    className={`csw-code-tab ${codeTab === option.id ? "csw-code-tab-active" : ""}`}
                    onClick={() => setCodeTab(option.id)}
                  >
                    {option.shortLabel}
                  </button>
                ))}
              </div>

              <CodeSnippetBlock segments={codeSegments} copyText={codePlainText} />

              <p className="csw-panel-desc csw-agent-id-note">
                Replace <code className="csw-inline-code">your-agent-id</code> with:{" "}
                <code className="csw-inline-code csw-code-customize">{selectedAgentId || "your-agent-id"}</code>
              </p>

              <div className="csw-panel-actions">
                <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button variant="primary" icon={ArrowRight} onClick={() => setStep(4)}>
                  Next: Test connection →
                </Button>
              </div>
            </section>
          ) : null}

          {step === 4 ? (
            <section className="csw-panel ds-panel" aria-labelledby="csw-step4-title">
              <h1 id="csw-step4-title" className="csw-panel-title">
                Test your connection
              </h1>
              <p className="csw-panel-desc">Test an action to verify everything works.</p>

              <div className="csw-test-form">
                <label className="csw-field">
                  <span>Tool</span>
                  <select
                    className="csw-select"
                    value={selectedToolId}
                    onChange={(event) => handleToolChange(event.target.value)}
                  >
                    {CONNECTION_TEST_TOOLS.map((tool) => (
                      <option key={tool.id} value={tool.id}>
                        {tool.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="csw-field">
                  <span>Sample payload</span>
                  <textarea
                    className="csw-json-editor"
                    rows={8}
                    value={payloadJson}
                    onChange={(event) => {
                      setPayloadJson(event.target.value);
                      setTestStatus("idle");
                    }}
                    spellCheck={false}
                  />
                </label>

                <Button
                  variant="secondary"
                  loading={testStatus === "loading"}
                  onClick={() => void runTest()}
                  disabled={!selectedAgentId}
                >
                  Run test action
                </Button>
              </div>

              {testStatus === "loading" ? (
                <p className="csw-test-status csw-test-loading">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Testing connection…
                </p>
              ) : null}

              {testStatus === "success" && testResult ? (
                <div className="csw-test-result csw-test-success" role="status">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" strokeWidth={2} />
                  <div>
                    <p className="csw-test-result-title">✓ Connection successful!</p>
                    <p className="csw-test-result-desc">
                      Your agent is now protected by Wave
                    </p>
                    <p className="csw-test-decision">
                      Response:{" "}
                      <code>decision: {formatSafetyDecision(testResult.decision)}</code>
                    </p>
                  </div>
                </div>
              ) : null}

              {testStatus === "error" ? (
                <div className="csw-test-result csw-test-failure" role="alert">
                  <XCircle className="h-5 w-5 shrink-0 text-red-400" strokeWidth={2} />
                  <div>
                    <p className="csw-test-result-title">✗ Connection failed</p>
                    <p className="csw-test-result-desc">Check your API key and try again</p>
                    <button
                      type="button"
                      className="ds-btn ds-btn-secondary ds-btn-sm mt-2"
                      onClick={() => {
                        setTestStatus("idle");
                        setError(null);
                        void runTest();
                      }}
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="csw-panel-actions">
                <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(3)}>
                  Back
                </Button>
                <Button
                  variant="primary"
                  className="csw-finish-btn"
                  onClick={handleFinish}
                  disabled={testStatus !== "success"}
                >
                  Finish setup →
                </Button>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}
