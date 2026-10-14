"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentApiKeyRecord } from "@/lib/gateway/types";
import {
  loadAgentLifecycle,
  saveAgentLifecycle,
} from "@/lib/agent-builder/agent-lifecycle";
import ConfigureProtectionStepModal from "@/components/agents/ConfigureProtectionStepModal";
import ConnectAgentStepModal from "@/components/agents/ConnectAgentStepModal";
import RunTestActionStepModal from "@/components/agents/RunTestActionStepModal";
import AgentSetupCompleteCard from "@/components/agents/setup/AgentSetupCompleteCard";
import AgentRequirementsList from "@/components/agents/setup/AgentRequirementsList";
import type { AgentRequirement, AgentRequirementsResult } from "@/lib/agents/requirements/types";
import { showTrustToastByKey } from "@/lib/trust/dashboard-trust";

type ActiveModal = "protection" | "connect" | "test" | null;

interface AgentSetupChecklistProps {
  agentId: string;
  agentName: string;
  apiKey: AgentApiKeyRecord | null;
  actionsProcessed?: number;
  refreshKey?: number;
  onProgressChange?: () => void;
}

export default function AgentSetupChecklist({
  agentId,
  agentName,
  apiKey,
  actionsProcessed = 0,
  refreshKey = 0,
  onProgressChange,
}: AgentSetupChecklistProps) {
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [result, setResult] = useState<AgentRequirementsResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRequirements = useCallback(async () => {
    const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/requirements`);
    const payload = (await response.json()) as AgentRequirementsResult & {
      success?: boolean;
      error?: string;
    };
    if (!response.ok) {
      setError(payload.error ?? "Could not load this agent's requirements.");
      return;
    }
    setResult(payload);
    setError(null);
  }, [agentId]);

  useEffect(() => {
    void loadRequirements();
  }, [loadRequirements, refreshKey]);

  const bump = () => {
    onProgressChange?.();
    void loadRequirements();
  };

  const onConfigure = async (requirement: AgentRequirement, value?: string) => {
    if (requirement.key === "safety" || requirement.configurationType === "policy") {
      setActiveModal("protection");
      return;
    }

    const body: Record<string, unknown> = {};
    if (value) {
      body.key = requirement.key;
      body.value = value;
    }
    if (requirement.configurationType === "email" && value) {
      body.destinationEmail = value;
      if (requirement.key === "email") {
        body.deliveryMode = "email";
        body.outputChoice = "email";
      }
    }
    if (requirement.configurationType === "phone" && value) {
      body.destinationPhone = value;
      if (requirement.key === "whatsapp") {
        body.deliveryMode = "whatsapp";
        body.outputChoice = "whatsapp";
      }
    }
    if (requirement.configurationType === "schedule" && value) {
      try {
        const parsed = JSON.parse(value) as { when?: string; time?: string; timezone?: string };
        body.scheduleWhen = parsed.when;
        body.scheduleTime = parsed.time;
        body.timezone = parsed.timezone;
      } catch {
        body.scheduleWhen = "daily";
      }
    }
    if (requirement.configurationType === "choice" && value) {
      if (requirement.key === "output_destination") body.outputChoice = value;
      if (requirement.key === "customer_source") body.customerSource = value;
    }

    if (Object.keys(body).length === 0) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/requirements`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as AgentRequirementsResult & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not save.");
      setResult(payload);
      bump();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {result ? (
        <AgentRequirementsList
          result={result}
          saving={saving}
          error={error}
          onConfigure={(item, value) => void onConfigure(item, value)}
          testHref={`/agents/${encodeURIComponent(agentId)}/prepare`}
        />
      ) : error ? (
        <p className="ag-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="asp-checklist-step-sub">Loading what this agent needs…</p>
      )}

      {result?.ready ? (
        <AgentSetupCompleteCard
          agentName={agentName}
          actionsProcessed={actionsProcessed}
          agentId={agentId}
        />
      ) : null}

      <ConfigureProtectionStepModal
        open={activeModal === "protection"}
        agentId={agentId}
        onClose={() => setActiveModal(null)}
        onSaved={() => {
          const latest = loadAgentLifecycle(agentId);
          saveAgentLifecycle(agentId, latest);
          bump();
          showTrustToastByKey("protectionConfigured");
        }}
      />

      <ConnectAgentStepModal
        open={activeModal === "connect"}
        agentId={agentId}
        agentName={agentName}
        apiKey={apiKey}
        onClose={() => setActiveModal(null)}
        onSaved={() => {
          bump();
          showTrustToastByKey("connectionConfigured");
        }}
        onNext={() => setActiveModal("test")}
      />

      <RunTestActionStepModal
        open={activeModal === "test"}
        agentId={agentId}
        agentName={agentName}
        onClose={() => setActiveModal(null)}
        onTestPassed={() => {
          bump();
          showTrustToastByKey("testPassed");
        }}
      />
    </>
  );
}
