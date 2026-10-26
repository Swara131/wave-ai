"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import AgentSetupTrustBanner from "@/components/agents/setup/AgentSetupTrustBanner";
import AgentSetupChecklist from "@/components/agents/setup/AgentSetupChecklist";
import AgentSetupConfetti from "@/components/agents/setup/AgentSetupConfetti";
import AgentConfigurationCard from "@/components/agents/setup/AgentConfigurationCard";
import AgentActionsConfigCard from "@/components/agents/setup/AgentActionsConfigCard";
import AgentTryDemoSection from "@/components/agents/setup/AgentTryDemoSection";
import AgentConnectionKeyCard from "@/components/agents/setup/AgentConnectionKeyCard";
import AgentProtectionFlowDiagram from "@/components/agents/setup/AgentProtectionFlowDiagram";
import AgentTrustBadgesCard from "@/components/agents/setup/AgentTrustBadgesCard";
import AgentSetupNextSteps from "@/components/agents/setup/AgentSetupNextSteps";
import AgentSetupTrustFooter from "@/components/agents/setup/AgentSetupTrustFooter";
import type { AgentApiKeyRecord } from "@/lib/gateway/types";
import type { PendingApproval } from "@/lib/approval-types";
import type { AuditTimelineEntry } from "@/lib/audit/types";
import { loadCreatedAgentSession } from "@/lib/agent-builder/created-agent-session";
import { createProtectedLifecyclePatch } from "@/lib/agents/agent-mode";
import {
  fetchAgentSetupConfig,
  type AgentSetupConfig,
} from "@/lib/agents/load-agent-setup-config";
import { loadAgentLifecycle, saveAgentLifecycle } from "@/lib/agent-builder/agent-lifecycle";
import { computeProtectionToday } from "@/lib/dashboard/founder-copy";
import { isSetupChecklistComplete } from "@/lib/agent-builder/setup-progress-steps";
import { showSetupCompleteToast } from "@/lib/trust/dashboard-trust";
import TemplateSetupChecklist from "@/components/agents/templates/TemplateSetupChecklist";

const setupCompleteToastKey = (agentId: string) =>
  `zelta:setup-complete-toast:${agentId}`;

const setupCelebrationKey = (agentId: string) =>
  `zelta:setup-celebration:${agentId}`;

async function fetchAgentKeys(): Promise<AgentApiKeyRecord[]> {
  const response = await fetch("/api/gateway/keys");
  const payload = (await response.json()) as { keys?: AgentApiKeyRecord[]; error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to load agents.");
  }
  return payload.keys ?? [];
}

export default function AgentDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";

  const [keys, setKeys] = useState<AgentApiKeyRecord[]>([]);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditTimelineEntry[]>([]);
  const [agentConfig, setAgentConfig] = useState<AgentSetupConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progressRefresh, setProgressRefresh] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);

  const session = useMemo(
    () => (agentId ? loadCreatedAgentSession(agentId) : null),
    [agentId]
  );

  useEffect(() => {
    if (!agentId) return;
    const current = loadAgentLifecycle(agentId);
    if (current.mode === "standalone" && !current.protectionConfigured) {
      saveAgentLifecycle(agentId, createProtectedLifecyclePatch());
    }
  }, [agentId]);

  const loadData = useCallback(async () => {
    if (!agentId) {
      setLoading(false);
      return;
    }

    setLoadError(null);
    try {
      const [keysResult, approvalsRes, auditRes] = await Promise.all([
        fetchAgentKeys(),
        fetch("/api/approvals"),
        fetch("/api/audit/timeline?limit=200"),
      ]);

      setKeys(keysResult);

      if (approvalsRes.ok) {
        const payload = (await approvalsRes.json()) as { approvals?: PendingApproval[] };
        setApprovals(payload.approvals ?? []);
      }

      if (auditRes.ok) {
        const payload = (await auditRes.json()) as { entries?: AuditTimelineEntry[] };
        setAuditEntries(payload.entries ?? []);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load agent.");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const key = useMemo(
    () => keys.find((item) => !item.revokedAt && item.agentId === agentId) ?? null,
    [keys, agentId]
  );

  const lifecycle = useMemo(() => {
    const snapshot = loadAgentLifecycle(agentId || "");
    return progressRefresh >= 0 ? snapshot : snapshot;
  }, [agentId, progressRefresh]);

  const isComplete = isSetupChecklistComplete(lifecycle, key);

  useEffect(() => {
    if (!agentId || !key) {
      setAgentConfig(null);
      return;
    }

    let cancelled = false;
    void fetchAgentSetupConfig(agentId, key, isComplete).then((config) => {
      if (!cancelled) setAgentConfig(config);
    });

    return () => {
      cancelled = true;
    };
  }, [agentId, key, isComplete, progressRefresh]);

  const actionsMonitored = useMemo(
    () =>
      auditEntries.filter((entry) => {
        const id =
          (typeof entry.metadata?.agentId === "string" ? entry.metadata.agentId : null) ??
          entry.actor;
        return id === agentId;
      }).length,
    [auditEntries, agentId]
  );

  const todayStats = useMemo(
    () =>
      computeProtectionToday(
        auditEntries,
        approvals.filter((a) => a.agentId === agentId).length
      ),
    [auditEntries, approvals, agentId]
  );

  useEffect(() => {
    if (!isComplete || !agentId || typeof window === "undefined") return;

    const toastKey = setupCompleteToastKey(agentId);
    if (!sessionStorage.getItem(toastKey)) {
      sessionStorage.setItem(toastKey, "1");
      showSetupCompleteToast();
    }

    const celebrationKey = setupCelebrationKey(agentId);
    if (!sessionStorage.getItem(celebrationKey)) {
      sessionStorage.setItem(celebrationKey, "1");
      setShowConfetti(true);
      const timer = window.setTimeout(() => setShowConfetti(false), 2800);
      return () => window.clearTimeout(timer);
    }
  }, [isComplete, agentId]);

  if (!agentId) {
    return (
      <PageShell maxWidth="6xl">
        <div className="ag-missing ds-panel">
          <h1 className="ag-title">Agent not found</h1>
          <p className="ag-lead">Choose an agent from My Agents.</p>
          <Link href="/integrations" className="ds-btn ds-btn-primary mt-4">
            My Agents
          </Link>
        </div>
      </PageShell>
    );
  }

  if (loading) {
    return (
      <PageShell maxWidth="6xl">
        <div className="ag-loading">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Loading agent…
        </div>
      </PageShell>
    );
  }

  if (!key) {
    return (
      <PageShell maxWidth="6xl">
        <div className="ag-missing ds-panel">
          <h1 className="ag-title">Agent not found</h1>
          <p className="ag-lead">
            We couldn&apos;t find this agent. It may have been removed or the link is outdated.
          </p>
          <Link href="/integrations" className="ds-btn ds-btn-primary mt-4">
            My Agents
          </Link>
        </div>
      </PageShell>
    );
  }

  const agentName = agentConfig?.name ?? key.name ?? agentId;

  return (
    <PageShell maxWidth="6xl" className="asp-page">
      <div className="asp-layout fade-in-up">
        <Link href="/integrations" className="ag-back-link asp-back">
          <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          My Agents
        </Link>
        <nav className="flex flex-wrap gap-2" aria-label="Agent sections">
          <Link href={`/agents/${encodeURIComponent(agentId)}/workflow`} className="ds-btn ds-btn-secondary">
            Workflow
          </Link>
          <Link href={`/agents/${encodeURIComponent(agentId)}/edit`} className="ds-btn ds-btn-ghost">
            Edit
          </Link>
          <Link href={`/agents/${encodeURIComponent(agentId)}/prepare`} className="ds-btn ds-btn-ghost">
            Test
          </Link>
        </nav>

        {loadError ? (
          <p className="ag-error" role="alert">
            {loadError}
          </p>
        ) : null}

        <AgentSetupConfetti active={showConfetti} />

        <AgentSetupTrustBanner isLive={isComplete} isComplete={isComplete} />

        {searchParams.get("from") === "template" ||
        session?.templateName ||
        agentConfig?.templateName ? (
          <TemplateSetupChecklist />
        ) : null}

        <div className="asp-grid">
          <div className="asp-main">
            <AgentSetupChecklist
              agentId={agentId}
              agentName={agentName}
              apiKey={key}
              actionsProcessed={actionsMonitored}
              refreshKey={progressRefresh}
              onProgressChange={() => setProgressRefresh((v) => v + 1)}
            />

            {agentConfig ? (
              <>
                <AgentConfigurationCard config={agentConfig} />
                <AgentActionsConfigCard
                  agentId={agentId}
                  actions={
                    agentConfig.templateSlug === "lighting-concierge" ||
                    agentConfig.templateSlug === "travel-companion" ||
                    agentConfig.templateSlug === "wedding-celebration-planner" ||
                    agentConfig.templateSlug === "group-decision-planner"
                      ? agentConfig.actions.filter((action) => action.id !== "send_email")
                      : agentConfig.actions
                  }
                  hasActions={
                    agentConfig.templateSlug === "lighting-concierge" ||
                    agentConfig.templateSlug === "travel-companion" ||
                    agentConfig.templateSlug === "wedding-celebration-planner" ||
                    agentConfig.templateSlug === "group-decision-planner"
                      ? agentConfig.actions.some((action) => action.id !== "send_email")
                      : agentConfig.hasActions
                  }
                />
              </>
            ) : null}

            {session?.plainKey ? <AgentConnectionKeyCard session={session} /> : null}

            {(todayStats.allowed > 0 ||
              todayStats.needsApproval > 0 ||
              todayStats.blocked > 0) ? (
              <section className="asp-card asp-today" aria-labelledby="asp-today-heading">
                <h2 id="asp-today-heading" className="asp-card-title">
                  Actions today
                </h2>
                <dl className="asp-today-grid">
                  <div>
                    <dt>Allowed</dt>
                    <dd className="asp-stat-safe">{todayStats.allowed}</dd>
                  </div>
                  <div>
                    <dt>Needs approval</dt>
                    <dd className="asp-stat-warn">{todayStats.needsApproval}</dd>
                  </div>
                  <div>
                    <dt>Blocked</dt>
                    <dd className="asp-stat-danger">{todayStats.blocked}</dd>
                  </div>
                </dl>
              </section>
            ) : null}

            <AgentTryDemoSection
              agentId={agentId}
              agentName={agentName}
              templateSlug={agentConfig?.templateSlug}
              onTestPassed={() => setProgressRefresh((v) => v + 1)}
            />
          </div>

          <aside className="asp-sidebar">
            <AgentProtectionFlowDiagram />
            <AgentTrustBadgesCard />
            <AgentSetupNextSteps agentId={agentId} />
          </aside>
        </div>

        <AgentSetupTrustFooter />
      </div>
    </PageShell>
  );
}
