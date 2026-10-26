import type {
  DecisionAgentConfig,
  DecisionInputField,
  DecisionInputKind,
  DecisionOutcome,
  DecisionRiskLevel,
  DecisionRule,
  DecisionUnit,
  DecisionWorkflowEdge,
  DecisionWorkflowNode,
} from "./types";

function isDecisionOutcome(value: unknown): value is DecisionOutcome {
  return value === "allow" || value === "review" || value === "block";
}

function isDecisionRiskLevel(value: unknown): value is DecisionRiskLevel {
  return value === "low" || value === "medium" || value === "high";
}

function parseRule(value: unknown): DecisionRule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.label !== "string" ||
    typeof row.expression !== "string" ||
    !isDecisionOutcome(row.outcome)
  ) {
    return null;
  }
  return {
    id: row.id,
    label: row.label,
    expression: row.expression,
    outcome: row.outcome,
    isAiGenerated: row.isAiGenerated === true,
  };
}

function parseWorkflowNode(value: unknown): DecisionWorkflowNode | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.type !== "string" ||
    typeof row.name !== "string" ||
    typeof row.description !== "string" ||
    typeof row.position !== "number"
  ) {
    return null;
  }
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    description: row.description,
    position: row.position,
    x: typeof row.x === "number" ? row.x : undefined,
    y: typeof row.y === "number" ? row.y : undefined,
  };
}

function parseWorkflowEdge(value: unknown): DecisionWorkflowEdge | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.source !== "string" || typeof row.target !== "string") {
    return null;
  }
  return {
    id: row.id,
    source: row.source,
    target: row.target,
    label: typeof row.label === "string" ? row.label : undefined,
  };
}

export function parseDecisionAgentConfig(value: unknown): DecisionAgentConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.decisionQuestion !== "string") return null;
  if (!Array.isArray(row.inputs) || !row.inputs.every((item) => typeof item === "string")) {
    return null;
  }
  if (!Array.isArray(row.actions) || !row.actions.every((item) => typeof item === "string")) {
    return null;
  }
  if (typeof row.approvalWhen !== "string") return null;
  if (typeof row.aiReasoningEnabled !== "boolean") return null;
  if (!Array.isArray(row.rules) || !Array.isArray(row.workflow)) return null;

  const rules: DecisionRule[] = [];
  for (const item of row.rules) {
    const rule = parseRule(item);
    if (!rule) return null;
    rules.push(rule);
  }

  const workflow: DecisionWorkflowNode[] = [];
  for (const item of row.workflow) {
    const node = parseWorkflowNode(item);
    if (!node) return null;
    workflow.push(node);
  }

  const config: DecisionAgentConfig = {
    decisionQuestion: row.decisionQuestion,
    inputs: row.inputs,
    rules,
    actions: row.actions,
    approvalWhen: row.approvalWhen,
    workflow,
    aiReasoningEnabled: row.aiReasoningEnabled,
  };

  if (isDecisionRiskLevel(row.riskLevel)) config.riskLevel = row.riskLevel;
  if (typeof row.approvalLevel === "string") config.approvalLevel = row.approvalLevel;
  if (
    Array.isArray(row.possibleOutcomes) &&
    row.possibleOutcomes.every(isDecisionOutcome)
  ) {
    config.possibleOutcomes = row.possibleOutcomes;
  }
  if (typeof row.generatedAt === "string") config.generatedAt = row.generatedAt;

  if (Array.isArray(row.edges)) {
    const edges: DecisionWorkflowEdge[] = [];
    for (const item of row.edges) {
      const edge = parseWorkflowEdge(item);
      if (edge) edges.push(edge);
    }
    if (edges.length) config.edges = edges;
  }

  if (Array.isArray(row.inputFields)) {
    const fields: DecisionInputField[] = [];
    for (const item of row.inputFields) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const field = item as Record<string, unknown>;
      const type = field.type;
      if (
        typeof field.key !== "string" ||
        typeof field.label !== "string" ||
        typeof field.description !== "string" ||
        (type !== "text" &&
          type !== "textarea" &&
          type !== "number" &&
          type !== "boolean" &&
          type !== "choice")
      ) {
        continue;
      }
      const options = Array.isArray(field.options)
        ? field.options
            .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
            .map((entry) => ({
              id: String(entry.id ?? ""),
              label: String(entry.label ?? entry.id ?? ""),
            }))
            .filter((entry) => entry.id)
        : undefined;
      fields.push({
        key: field.key,
        label: field.label,
        type: type as DecisionInputKind,
        required: field.required !== false,
        description: field.description,
        ...(options?.length ? { options } : {}),
      });
    }
    if (fields.length) config.inputFields = fields;
  }

  if (Array.isArray(row.decisions)) {
    const decisions: DecisionUnit[] = [];
    for (const item of row.decisions) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const unit = item as Record<string, unknown>;
      if (
        typeof unit.id !== "string" ||
        typeof unit.title !== "string" ||
        typeof unit.description !== "string" ||
        !Array.isArray(unit.inputs) ||
        !Array.isArray(unit.rules)
      ) {
        continue;
      }
      const unitRules: DecisionRule[] = [];
      for (const ruleValue of unit.rules) {
        const rule = parseRule(ruleValue);
        if (rule) unitRules.push(rule);
      }
      if (!unitRules.length) continue;
      decisions.push({
        id: unit.id,
        title: unit.title,
        description: unit.description,
        inputs: unit.inputs.filter((entry): entry is string => typeof entry === "string"),
        rules: unitRules,
      });
    }
    if (decisions.length) config.decisions = decisions;
  }

  return config;
}

export function emptyDecisionAgentConfig(): DecisionAgentConfig {
  return {
    decisionQuestion: "",
    inputs: [],
    rules: [],
    actions: [],
    approvalWhen: "",
    workflow: [],
    aiReasoningEnabled: false,
  };
}

export function parseDecisionAgentConfigOrDefault(value: unknown): DecisionAgentConfig {
  return parseDecisionAgentConfig(value) ?? emptyDecisionAgentConfig();
}
