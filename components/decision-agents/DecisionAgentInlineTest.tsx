"use client";

import DecisionLiveRun from "@/components/decision-agents/DecisionLiveRun";
import type { DecisionAgentConfig } from "@/lib/decision-agents/types";

interface DecisionAgentInlineTestProps {
  config: DecisionAgentConfig;
  slug?: string | null;
  onClose: () => void;
}

export default function DecisionAgentInlineTest({
  config,
  slug,
  onClose,
}: DecisionAgentInlineTestProps) {
  return (
    <section className="zdec-inline-test">
      <div className="zdec-inline-test-header">
        <h3>Live decisions</h3>
        <button type="button" className="zplat-btn zplat-btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <DecisionLiveRun
        config={config}
        slug={slug}
        title="Decision agent"
        purpose="Live research run"
      />
    </section>
  );
}
