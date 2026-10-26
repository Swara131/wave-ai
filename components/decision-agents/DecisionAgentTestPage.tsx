"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import { MissingRequirementsBanner } from "@/components/agents/setup/AgentRequirementsList";
import { getAgentRequirements } from "@/lib/agents/requirements/engine";
import { snapshotFromDecisionAgent } from "@/lib/agents/requirements/from-decision";
import type { DecisionAgentRecord } from "@/lib/decision-agents/types";
import DecisionLiveRun from "@/components/decision-agents/DecisionLiveRun";

export default function DecisionAgentTestPage() {
  const params = useParams();
  const slug = typeof params.agentId === "string" ? params.agentId.trim() : "";
  const [agent, setAgent] = useState<DecisionAgentRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    const response = await fetch(`/api/v1/decision-agents/${encodeURIComponent(slug)}`);
    const payload = (await response.json()) as { agent?: DecisionAgentRecord };
    setAgent(payload.agent ?? null);
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <PageShell layout="workspace" className="studio-shell">
        <p className="prep-loading">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading…
        </p>
      </PageShell>
    );
  }

  if (!agent) {
    return (
      <PageShell layout="workspace" className="studio-shell">
        <p>Decision agent not found.</p>
      </PageShell>
    );
  }

  const missing = getAgentRequirements(snapshotFromDecisionAgent(agent, { stage: "test" })).missing;

  return (
    <PageShell layout="workspace" className="studio-shell">
      <div className="zdec-studio">
        <Link href={`/decision-agents/${encodeURIComponent(slug)}`} className="run-back">
          ← Back
        </Link>
        <p className="studio-kicker">Live decisions</p>
        <h1>{agent.name}</h1>
        {missing.length > 0 ? <MissingRequirementsBanner missing={missing} /> : null}
        <DecisionLiveRun
          config={agent.config}
          slug={slug}
          title={agent.name}
          purpose={agent.purpose}
          backHref={`/decision-agents/${encodeURIComponent(slug)}/test`}
        />
      </div>
    </PageShell>
  );
}
