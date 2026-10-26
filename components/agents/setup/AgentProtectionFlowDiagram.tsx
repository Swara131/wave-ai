"use client";

import {
  Bot,
  Brain,
  CheckCircle2,
  KeyRound,
  Shield,
  Zap,
} from "lucide-react";

const FLOW_STEPS = [
  {
    icon: Bot,
    label: "Your AI agent",
    description: "Agent proposes an action",
    tone: "input",
  },
  {
    icon: Shield,
    label: "Wave gateway",
    description: "Secure entry point",
    tone: "brand",
  },
  {
    icon: CheckCircle2,
    label: "Policy check",
    description: "Rules and thresholds",
    tone: "input",
  },
  {
    icon: Brain,
    label: "Risk analysis",
    description: "Context-aware scoring",
    tone: "input",
  },
  {
    icon: CheckCircle2,
    label: "Approve / Block / Allow",
    description: "Human or auto decision",
    tone: "decision",
  },
  {
    icon: KeyRound,
    label: "Execution token",
    description: "One-time authorization",
    tone: "safe",
  },
  {
    icon: Zap,
    label: "Action executed",
    description: "Only if approved",
    tone: "safe",
  },
] as const;

export default function AgentProtectionFlowDiagram() {
  return (
    <section className="asp-card asp-flow" aria-labelledby="asp-flow-heading">
      <h2 id="asp-flow-heading" className="asp-card-title">
        How Wave Protects This Agent
      </h2>
      <p className="asp-card-subtitle">Every action goes through this safety gate before it can run.</p>

      <div className="asp-flow-diagram" aria-label="Wave protection flow">
        {FLOW_STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <div key={step.label} className="asp-flow-step-wrap">
              <div
                className={`asp-flow-step asp-flow-step-${step.tone} asp-flow-step-enter`}
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <span className="asp-flow-icon-wrap" aria-hidden="true">
                  <Icon className="asp-flow-icon" strokeWidth={1.75} />
                </span>
                <p className="asp-flow-label">{step.label}</p>
                <p className="asp-flow-desc">{step.description}</p>
              </div>
              {index < FLOW_STEPS.length - 1 ? (
                <span className="asp-flow-arrow" aria-hidden="true">
                  ↓
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
