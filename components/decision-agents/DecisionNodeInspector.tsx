"use client";

import { Plus, Trash2 } from "lucide-react";
import type { DecisionAgentConfig, DecisionOutcome, DecisionRule, DecisionWorkflowNode } from "@/lib/decision-agents/types";
import { isDecisionOutcome } from "@/lib/decision-agents/canvas-graph";

interface DecisionNodeInspectorProps {
  node: DecisionWorkflowNode;
  config: DecisionAgentConfig;
  onPatchNode: (nodeId: string, patch: Partial<DecisionWorkflowNode>) => void;
  onPatchRules: (unitId: string, rules: DecisionRule[]) => void;
  onDelete: (nodeId: string) => void;
  onClose: () => void;
}

const OUTCOMES: DecisionOutcome[] = ["allow", "review", "block"];

export default function DecisionNodeInspector({
  node,
  config,
  onPatchNode,
  onPatchRules,
  onDelete,
  onClose,
}: DecisionNodeInspectorProps) {
  const unit = config.decisions?.find((item) => item.id === node.id);

  const addRule = () => {
    if (!unit) return;
    onPatchRules(unit.id, [
      ...unit.rules,
      {
        id: `${unit.id}-rule-${unit.rules.length + 1}`,
        label: "New rule",
        expression: "otherwise",
        outcome: "review",
      },
    ]);
  };

  const changeRule = (ruleId: string, patch: Partial<DecisionRule>) => {
    if (!unit) return;
    onPatchRules(
      unit.id,
      unit.rules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule))
    );
  };

  const removeRule = (ruleId: string) => {
    if (!unit) return;
    const next = unit.rules.filter((rule) => rule.id !== ruleId);
    onPatchRules(unit.id, next.length ? next : unit.rules);
  };

  return (
    <aside className="wfb-config zdec-inspector nodrag nopan" aria-label="Node configuration">
      <div className="wfb-config-header">
        <h3>{node.name}</h3>
        <button type="button" className="wfb-config-close" onClick={onClose}>
          Close
        </button>
      </div>

      <label className="wfb-config-field">
        <span>Name</span>
        <input
          className="ds-input"
          value={node.name}
          onChange={(event) => onPatchNode(node.id, { name: event.target.value })}
        />
      </label>

      <label className="wfb-config-field">
        <span>What this step does</span>
        <textarea
          className="ds-input"
          rows={3}
          value={node.description}
          onChange={(event) => onPatchNode(node.id, { description: event.target.value })}
        />
      </label>

      {unit ? (
        <div className="zdec-inspector-rules">
          <div className="zdec-inspector-rules-head">
            <h4>Decision rules</h4>
            <button type="button" className="wfb-zoom-btn" onClick={addRule}>
              <Plus className="h-3.5 w-3.5" />
              Add rule
            </button>
          </div>
          {unit.rules.map((rule) => (
            <article key={rule.id} className="zdec-inspector-rule">
              <input
                className="ds-input"
                value={rule.label}
                aria-label="Rule label"
                onChange={(event) => changeRule(rule.id, { label: event.target.value })}
              />
              <input
                className="ds-input"
                value={rule.expression}
                aria-label="Rule expression"
                onChange={(event) => changeRule(rule.id, { expression: event.target.value })}
              />
              <div className="zdec-inspector-rule-row">
                <select
                  className="ds-input"
                  value={rule.outcome}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (isDecisionOutcome(value)) changeRule(rule.id, { outcome: value });
                  }}
                >
                  {OUTCOMES.map((outcome) => (
                    <option key={outcome} value={outcome}>
                      {outcome.toUpperCase()}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="wfb-zoom-btn"
                  onClick={() => removeRule(rule.id)}
                  aria-label="Delete rule"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <button type="button" className="wfb-zoom-btn" onClick={() => onDelete(node.id)}>
        Delete box
      </button>
    </aside>
  );
}
