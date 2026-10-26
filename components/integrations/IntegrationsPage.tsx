"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Key,
  Plus,
  Copy,
  Check,
  Code2,
  AlertTriangle,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { AgentCreatedToast } from "@/components/agent-builder/AgentBuilderModal";
import PageShell from "@/components/ui/PageShell";
import Button from "@/components/ui/Button";
import MyAgentsHero from "@/components/integrations/MyAgentsHero";
import type { AgentApiKeyRecord } from "@/lib/gateway/types";
import type { PendingApproval } from "@/lib/approval-types";
import type { AuditTimelineEntry } from "@/lib/audit/types";
import { loadCreatedAgentSession } from "@/lib/agent-builder/created-agent-session";
import MyAgentCard from "@/components/integrations/MyAgentCard";
import AgentsPathSelector from "@/components/integrations/AgentsPathSelector";
import AgentsTrustBanner from "@/components/integrations/AgentsTrustBanner";
import AgentsSecurityOverview from "@/components/integrations/AgentsSecurityOverview";
import AgentsBottomCTA from "@/components/integrations/AgentsBottomCTA";
import ZeroAgentsEmptyState from "@/components/trust/empty-states/ZeroAgentsEmptyState";
import {
  buildAgentCards,
  isDemoAgent,
} from "@/lib/dashboard/founder-copy";
import { buildSecurityOverviewMetrics } from "@/lib/integrations/agent-trust-metrics";
import type { DecisionAgentRecord } from "@/lib/decision-agents/types";
import {
  buildProposeExamples,
  buildStatusExamples,
  buildVerifyExamples,
  type IntegrationExampleLanguage,
} from "@/lib/gateway/integration-examples";

type ExampleTab = "propose" | "status" | "verify";
type LangTab = IntegrationExampleLanguage;

interface CreatedKeyReveal {
  plainKey: string;
  keyPrefix: string;
  agentId: string;
}

async function fetchAgentKeys(): Promise<AgentApiKeyRecord[]> {
  const response = await fetch("/api/gateway/keys");
  const payload = (await response.json()) as { keys?: AgentApiKeyRecord[]; error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to load agents.");
  }
  return payload.keys ?? [];
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="ds-btn ds-btn-ghost ds-btn-sm inline-flex items-center gap-1.5"
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-400" strokeWidth={2} />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={2} />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function IntegrationsPage() {
  const searchParams = useSearchParams();
  const connectAgentId = searchParams.get("agent")?.trim() ?? "";
  const connectMode = searchParams.get("connect") === "1";
  const setupApi = searchParams.get("setup") === "api";

  const [keys, setKeys] = useState<AgentApiKeyRecord[]>([]);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditTimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<CreatedKeyReveal | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState("demo-refund-agent");
  const [keyName, setKeyName] = useState("Local demo agent");
  const [progressRefresh, setProgressRefresh] = useState(0);
  const [agentSources, setAgentSources] = useState<
    Record<string, { origin: string; label: string }>
  >({});
  const [decisionAgents, setDecisionAgents] = useState<DecisionAgentRecord[]>([]);

  const [exampleTab, setExampleTab] = useState<ExampleTab>("propose");
  const [langTab, setLangTab] = useState<LangTab>("curl");

  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const loadData = useCallback(async () => {
    setLoadError(null);
    try {
      const [keysResult, approvalsRes, auditRes, sourcesRes, decisionRes] = await Promise.all([
        fetchAgentKeys(),
        fetch("/api/approvals"),
        fetch("/api/audit/timeline?limit=200"),
        fetch("/api/v1/agents/sources"),
        fetch("/api/v1/decision-agents"),
      ]);

      setKeys(keysResult);

      if (sourcesRes.ok) {
        const sourcesPayload = (await sourcesRes.json()) as {
          sources?: Record<string, { origin: string; label: string }>;
        };
        setAgentSources(sourcesPayload.sources ?? {});
      }

      if (decisionRes.ok) {
        const decisionPayload = (await decisionRes.json()) as {
          agents?: DecisionAgentRecord[];
        };
        setDecisionAgents(decisionPayload.agents ?? []);
      } else {
        setDecisionAgents([]);
      }

      if (approvalsRes.ok) {
        const payload = (await approvalsRes.json()) as { approvals?: PendingApproval[] };
        setApprovals(payload.approvals ?? []);
      }

      if (auditRes.ok) {
        const payload = (await auditRes.json()) as { entries?: AuditTimelineEntry[] };
        setAuditEntries(payload.entries ?? []);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load agents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (setupApi) {
      setAdvancedOpen(true);
    }
  }, [setupApi]);

  useEffect(() => {
    if (!connectAgentId || loading) return;
    setExpandedAgentId(connectAgentId);

    if (connectMode) {
      const session = loadCreatedAgentSession(connectAgentId);
      if (session) {
        setRevealedKey({
          plainKey: session.plainKey,
          keyPrefix: session.keyPrefix,
          agentId: session.agentId,
        });
        setAgentId(session.agentId);
        setKeyName(session.spec.name);
      }
    }

    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`agent-${connectAgentId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [connectAgentId, connectMode, loading]);

  const activeKeys = keys.filter((key) => !key.revokedAt);
  const agents = useMemo(
    () => buildAgentCards(keys, approvals, auditEntries),
    [keys, approvals, auditEntries]
  );

  const { exampleAgents, yourAgents } = useMemo(() => {
    const example: typeof agents = [];
    const yours: typeof agents = [];
    for (const agent of agents) {
      if (isDemoAgent(agent)) {
        example.push(agent);
      } else {
        yours.push(agent);
      }
    }
    return { exampleAgents: example, yourAgents: yours };
  }, [agents]);

  const keyByAgentId = useMemo(() => {
    const map = new Map<string, AgentApiKeyRecord>();
    for (const key of activeKeys) {
      map.set(key.agentId, key);
    }
    return map;
  }, [activeKeys]);

  const securityOverview = useMemo(
    () => buildSecurityOverviewMetrics(auditEntries),
    [auditEntries]
  );

  const exampleAgentId = agents[0]?.id ?? agentId;
  const exampleProposalId = "00000000-0000-4000-8000-000000000001";

  const examples = useMemo(() => {
    const params = { baseUrl, agentId: exampleAgentId };
    if (exampleTab === "propose") return buildProposeExamples(params);
    if (exampleTab === "status") {
      return buildStatusExamples({ ...params, proposalId: exampleProposalId });
    }
    return buildVerifyExamples({ ...params, proposalId: exampleProposalId });
  }, [baseUrl, exampleAgentId, exampleProposalId, exampleTab]);

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);

    try {
      const response = await fetch("/api/gateway/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, name: keyName }),
      });

      const payload = (await response.json()) as {
        plainKey?: string;
        key?: AgentApiKeyRecord;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to create agent API key.");
      }

      if (!payload.plainKey || !payload.key) {
        throw new Error("Unexpected response from key creation.");
      }

      setRevealedKey({
        plainKey: payload.plainKey,
        keyPrefix: payload.key.keyPrefix,
        agentId: payload.key.agentId,
      });
      setAdvancedOpen(true);
      await loadData();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create key.");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    try {
      const response = await fetch(`/api/gateway/keys/${id}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to revoke key.");
      }
      await loadData();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to revoke key.");
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <PageShell maxWidth="6xl" className="ma-page">
      <MyAgentsHero />

      <AgentsPathSelector />

      <AgentsTrustBanner />

      {connectMode && connectAgentId ? (
        <section className="ma-connect-banner ds-panel" aria-live="polite">
          <h2 className="ma-connect-banner-title">Connect this agent</h2>
          <p className="ma-connect-banner-desc">
            Copy your API key below and add it to your agent code. When your agent sends its
            first action through Wave, connection will show as complete on your agent setup
            page.
          </p>
          <Link
            href={`/onboarding/connect/wizard?agent=${encodeURIComponent(connectAgentId)}&platform=zelta`}
            className="ds-btn ds-btn-primary ds-btn-sm mt-3 inline-flex"
          >
            Continue to setup →
          </Link>
          <Link
            href={`/agents/${encodeURIComponent(connectAgentId)}`}
            className="ds-btn ds-btn-secondary ds-btn-sm mt-3 inline-flex"
          >
            Back to agent setup
          </Link>
        </section>
      ) : null}

      {loadError ? (
        <p className="text-sm text-red-400" role="alert">
          {loadError}
        </p>
      ) : null}

      {loading ? (
        <div className="ma-loading">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Loading your agents…
        </div>
      ) : agents.length === 0 && decisionAgents.length === 0 ? (
        <>
          <AgentsSecurityOverview metrics={securityOverview} />
          <ZeroAgentsEmptyState />
        </>
      ) : (
        <>
          <AgentsSecurityOverview metrics={securityOverview} />

          {exampleAgents.length > 0 ? (
            <section className="ds-section ma-examples-section" aria-labelledby="examples-heading">
              <h2 id="examples-heading" className="ma-section-title">
                Examples
              </h2>
              <p className="ma-section-desc ma-examples-helper">
                These are safe, sandboxed examples. Delete them when ready to go live.
              </p>
              <div className="ma-agent-grid">
                {exampleAgents.map((agent) => {
                  const key = keyByAgentId.get(agent.id);
                  return (
                    <MyAgentCard
                      key={agent.id}
                      agent={agent}
                      apiKey={key ?? null}
                      approvals={approvals}
                      auditEntries={auditEntries}
                      progressRefresh={progressRefresh}
                      variant="example"
                      expanded={false}
                      revoking={revokingId === key?.id}
                      onToggleExpand={() => undefined}
                      onProgressChange={() => setProgressRefresh((v) => v + 1)}
                      onDelete={key ? () => void handleRevoke(key.id) : undefined}
                      formatDate={formatDate}
                    />
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="ds-section" aria-labelledby="agents-list-heading">
            <h2 id="agents-list-heading" className="ma-section-title">
              Your agents
            </h2>
            {yourAgents.length === 0 && decisionAgents.length === 0 ? (
              <ZeroAgentsEmptyState variant="compact" />
            ) : (
              <div className="ma-agent-grid">
                {decisionAgents.map((agent) => (
                  <article key={agent.id} className="ma-agent-card ma-agent-card-v2 ds-panel">
                    <div className="ma-agent-v2-head">
                      <div>
                        <h3 className="ma-agent-name">{agent.name}</h3>
                        <p className="ma-agent-type">
                          <span className="ma-agent-source-badge">● Multiple decisions</span>
                        </p>
                      </div>
                      <span className="ma-agent-runtime-badge ma-agent-runtime-badge-active">
                        {agent.status}
                      </span>
                    </div>
                    <p className="ma-agent-purpose">&ldquo;{agent.purpose}&rdquo;</p>
                    <div className="ma-agent-actions ma-agent-actions-v2">
                      <Link
                        href={`/decision-agents/${encodeURIComponent(agent.slug)}`}
                        className="ds-btn ds-btn-primary ds-btn-sm"
                      >
                        Open
                      </Link>
                      <Link
                        href={`/decision-agents/${encodeURIComponent(agent.slug)}/test`}
                        className="ds-btn ds-btn-secondary ds-btn-sm"
                      >
                        Run
                      </Link>
                    </div>
                  </article>
                ))}
                {yourAgents.map((agent) => {
                  const key = keyByAgentId.get(agent.id);
                  const expanded = expandedAgentId === agent.id;

                  return (
                    <MyAgentCard
                      key={agent.id}
                      agent={agent}
                      sourceBadge={agentSources[agent.id] ?? null}
                      apiKey={key ?? null}
                      approvals={approvals}
                      auditEntries={auditEntries}
                      progressRefresh={progressRefresh}
                      variant="default"
                      expanded={expanded}
                      revoking={revokingId === key?.id}
                      onToggleExpand={() =>
                        setExpandedAgentId(expanded ? null : agent.id)
                      }
                      onProgressChange={() => setProgressRefresh((v) => v + 1)}
                      onDelete={key ? () => void handleRevoke(key.id) : undefined}
                      formatDate={formatDate}
                    />
                  );
                })}
              </div>
            )}
          </section>

          <AgentsBottomCTA />
        </>
      )}

      {!loading && agents.length === 0 && decisionAgents.length === 0 ? (
        <AgentsBottomCTA />
      ) : null}

      <section className="ds-section ma-advanced">
        <button
          type="button"
          className="ma-advanced-toggle"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
            strokeWidth={2}
            aria-hidden="true"
          />
          Advanced — API keys & developer setup
          <span className="text-[var(--ds-text-tertiary)]">For technical integration</span>
        </button>

        {advancedOpen ? (
          <div className="ma-advanced-panel">
            <div className="ds-panel p-6">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-[var(--ds-brand)]" strokeWidth={2} aria-hidden="true" />
                <h3 className="text-sm font-semibold text-[var(--ds-text-primary)]">
                  Create agent API key
                </h3>
              </div>
              <p className="mt-1 text-sm text-[var(--ds-text-secondary)]">
                For connecting external agents directly. The full key is shown once — copy it
                before closing.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-[var(--ds-text-tertiary)]">
                    Agent ID
                  </span>
                  <input
                    className="ds-input w-full"
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                    placeholder="demo-refund-agent"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-[var(--ds-text-tertiary)]">
                    Key name
                  </span>
                  <input
                    className="ds-input w-full"
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="Local demo agent"
                  />
                </label>
              </div>

              {createError ? (
                <p className="mt-3 text-sm text-red-400" role="alert">
                  {createError}
                </p>
              ) : null}

              <div className="mt-4">
                <Button
                  variant="primary"
                  icon={Plus}
                  loading={creating}
                  onClick={() => void handleCreate()}
                >
                  Create API key
                </Button>
              </div>
            </div>

            {revealedKey ? (
              <div
                className="mt-4 rounded-xl border border-amber-400/25 bg-amber-500/8 p-6"
                role="alert"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle
                    className="mt-0.5 h-5 w-5 shrink-0 text-amber-400"
                    strokeWidth={2}
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-amber-200">Copy your API key now</h3>
                    <p className="mt-1 text-sm text-[var(--ds-text-secondary)]">
                      This plaintext key will not be shown again.
                    </p>
                    <pre className="mt-3 overflow-x-auto rounded-lg bg-black/40 p-3 font-mono text-xs text-zinc-200">
                      {revealedKey.plainKey}
                    </pre>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <CopyButton text={revealedKey.plainKey} />
                      <Button variant="secondary" size="sm" onClick={() => setRevealedKey(null)}>
                        I have saved the key
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="ds-panel mt-4 p-6">
              <div className="mb-4 flex items-center gap-2">
                <Code2 className="h-4 w-4 text-indigo-400" strokeWidth={2} />
                <h3 className="text-sm font-semibold text-[var(--ds-text-primary)]">
                  Integration examples
                </h3>
              </div>

              <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Example endpoint">
                {(
                  [
                    ["propose", "Propose action"],
                    ["status", "Poll status"],
                    ["verify", "Verify execution"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={exampleTab === key}
                    onClick={() => setExampleTab(key)}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      exampleTab === key
                        ? "bg-[var(--ds-brand)] text-white"
                        : "bg-[var(--ds-bg-subtle)] text-[var(--ds-text-secondary)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Example language">
                {(
                  [
                    ["curl", "curl"],
                    ["typescript", "TypeScript"],
                    ["python", "Python"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={langTab === key}
                    onClick={() => setLangTab(key)}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      langTab === key
                        ? "bg-indigo-500/25 text-indigo-200"
                        : "bg-[var(--ds-bg-subtle)] text-[var(--ds-text-secondary)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="relative">
                <pre className="max-h-80 overflow-auto rounded-lg bg-black/40 p-4 font-mono text-xs leading-relaxed text-zinc-300">
                  {examples[langTab]}
                </pre>
                <div className="absolute right-3 top-3">
                  <CopyButton text={examples[langTab]} />
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <AgentCreatedToast />
    </PageShell>
  );
}
