"use client";

import { createElement } from "react";
import { COMPANY_NAME } from "@/lib/public-branding";
import { MARKETPLACE_CATEGORY_LABELS } from "@/lib/templates/categories";
import { safetyDefaultsForRisk } from "@/lib/templates/safety-defaults";
import type { AgentTemplate, MarketplaceCategory } from "@/lib/templates/types";
import { getDemoScenario } from "@/lib/templates/simulation/registry";
import Modal from "@/components/ui/Modal";
import { getTemplateIcon } from "./template-icons";

function TemplateGlyph({ icon }: { icon: string }) {
  return createElement(getTemplateIcon(icon), { className: "h-5 w-5" });
}

interface TemplatePreviewModalProps {
  template: AgentTemplate | null;
  open: boolean;
  onClose: () => void;
  onUse: () => void;
  onCustomize: () => void;
}

export default function TemplatePreviewModal({
  template,
  open,
  onClose,
  onUse,
  onCustomize,
}: TemplatePreviewModalProps) {
  if (!template) return null;

  const risk = template.riskLevel ?? "medium";
  const safety = safetyDefaultsForRisk(risk, template.tools);
  const scenario = getDemoScenario(template.slug ?? template.id);
  const categoryLabel =
    template.category in MARKETPLACE_CATEGORY_LABELS
      ? MARKETPLACE_CATEGORY_LABELS[template.category as MarketplaceCategory]
      : template.category;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={template.name}
      variant="center"
      size="lg"
      footer={
        <div className="ztpl-modal-footer">
          <button type="button" className="ds-btn ds-btn-secondary" onClick={onCustomize}>
            Customize before using
          </button>
          <button type="button" className="ds-btn ds-btn-primary" onClick={onUse}>
            Use this template
          </button>
        </div>
      }
    >
      <div className="ztpl-preview">
        <div className="ztpl-preview-hero">
          <span className="ztemplates-card-icon" aria-hidden="true">
            <TemplateGlyph icon={template.icon} />
          </span>
          <p>{template.longDescription ?? template.summary}</p>
        </div>
        <p className="ztpl-protected">Protected by {COMPANY_NAME}</p>
        <dl className="ztpl-preview-meta">
          <div>
            <dt>Category</dt>
            <dd>{categoryLabel}</dd>
          </div>
          <div>
            <dt>Risk</dt>
            <dd className={`ztpl-risk ztpl-risk-${risk}`}>{risk}</dd>
          </div>
          <div>
            <dt>Setup time</dt>
            <dd>~{template.estimatedSetupMinutes ?? 10} min</dd>
          </div>
          <div>
            <dt>Trigger</dt>
            <dd>{template.defaultTrigger ?? template.triggerType}</dd>
          </div>
        </dl>
        <section>
          <h3>Example tasks</h3>
          <ul>
            {(template.exampleTasks ?? []).map((task) => (
              <li key={task}>{task}</li>
            ))}
          </ul>
          {template.slug === "travel-companion" ? (
            <p>
              Try Example sample data (labelled sample, not a live booking): Jaipur, 10–12 Nov 2026, 2 travelers,
              ₹18,000, food + history + art, balanced pace, Old City.
            </p>
          ) : null}
          {template.slug === "wedding-celebration-planner" ? (
            <p>
              Try Example sample data (labelled sample, not a live vendor): Ananya &amp; Rohan, Jaipur, 12 Dec 2026,
              180 guests, ₹8,50,000, garden venue, vegetarian food. WAVE does not use Qloo for this template.
            </p>
          ) : null}
        </section>
        {scenario ? (
          <section>
            <h3>Simulation workflow</h3>
            <ol>
              {scenario.expectedSteps.map((step) => (
                <li key={step.id}>{step.label}</li>
              ))}
            </ol>
          </section>
        ) : null}
        <section>
          <h3>Suggested tools</h3>
          <p>{(template.suggestedIntegrations ?? template.tools).join(", ")}</p>
        </section>
        <section>
          <h3>Instructions (you can edit these)</h3>
          <p className="ztpl-instructions">{template.defaultInstructions}</p>
        </section>
        <section>
          <h3>Permissions</h3>
          <ul>
            {(template.defaultToolPermissions ?? safety.toolPermissions).map((item) => (
              <li key={item.tool}>
                {item.tool.replace(/_/g, " ")} — {item.permission.replace(/_/g, " ")}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Approvals</h3>
          <ul>
            {(template.defaultApprovalRules ?? safety.approvalRules).map((rule) => (
              <li key={rule.id}>{rule.label}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Limits</h3>
          <p>
            {template.defaultExecutionLimits?.maxToolCallsPerRun ??
              safety.executionLimits.maxToolCallsPerRun}{" "}
            tool calls/run · $
            {template.defaultExecutionLimits?.dailySpendingCapUsd ??
              safety.executionLimits.dailySpendingCapUsd}{" "}
            daily cap
          </p>
        </section>
        <section>
          <h3>Data protection</h3>
          <p>Prompt-injection defense, PII/secret detection, audit logs, and emergency pause are on.</p>
        </section>
        <section>
          <h3>Why this risk level</h3>
          <p>{safety.riskExplanation}</p>
        </section>
      </div>
    </Modal>
  );
}
