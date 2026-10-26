import type {
  DecisionAgentConfig,
  DecisionOutcome,
  DecisionRule,
  DecisionUnit,
  DecisionWorkflowEdge,
  DecisionWorkflowNode,
} from "./types";

const COL = { intake: 48, decisions: 400, combine: 760, output: 1120 };
const ROW = 230;
const START_Y = 48;

export function layoutDecisionWorkflow(nodes: DecisionWorkflowNode[]): DecisionWorkflowNode[] {
  const intake = nodes.filter((node) => node.type === "input");
  const decisions = nodes.filter((node) => node.type === "decision");
  const policy = nodes.filter((node) => node.type === "policy");
  const output = nodes.filter((node) => node.type === "action");
  const rest = nodes.filter(
    (node) => !["input", "decision", "policy", "action"].includes(node.type)
  );

  const next: DecisionWorkflowNode[] = [];
  const push = (node: DecisionWorkflowNode, x: number, y: number) => {
    next.push({ ...node, x, y, position: next.length });
  };

  intake.forEach((node, index) => push(node, COL.intake, START_Y + 40 + index * ROW));
  decisions.forEach((node, index) => push(node, COL.decisions, START_Y + index * ROW));
  policy.forEach((node, index) => push(node, COL.combine, START_Y + 40 + index * ROW));
  output.forEach((node, index) => push(node, COL.output, START_Y + 40 + index * ROW));
  rest.forEach((node, index) => push(node, COL.decisions + 40, START_Y + decisions.length * ROW + index * ROW));
  return next;
}

export function defaultDecisionEdges(nodes: DecisionWorkflowNode[]): DecisionWorkflowEdge[] {
  const intake = nodes.find((node) => node.type === "input");
  const decisions = nodes.filter((node) => node.type === "decision");
  const combine = nodes.find((node) => node.type === "policy");
  const output = nodes.find((node) => node.type === "action");
  const edges: DecisionWorkflowEdge[] = [];

  for (const decision of decisions) {
    if (intake) {
      edges.push({
        id: `e-${intake.id}-${decision.id}`,
        source: intake.id,
        target: decision.id,
      });
    }
    if (combine) {
      edges.push({
        id: `e-${decision.id}-${combine.id}`,
        source: decision.id,
        target: combine.id,
      });
    }
  }

  if (combine && output) {
    edges.push({
      id: `e-${combine.id}-${output.id}`,
      source: combine.id,
      target: output.id,
    });
  } else if (intake && output && decisions.length === 0) {
    edges.push({ id: `e-${intake.id}-${output.id}`, source: intake.id, target: output.id });
  }

  return edges;
}

export function newDecisionUnit(index: number): DecisionUnit {
  const id = `decision-${Date.now()}-${index}`;
  return {
    id,
    title: "New decision",
    description: "Name this judgment and write the rules that should fire.",
    inputs: [],
    rules: [
      {
        id: `${id}-review`,
        label: "Needs human review",
        expression: "otherwise",
        outcome: "review",
        isAiGenerated: false,
      },
    ],
  };
}

export function applyCanvasToConfig(
  config: DecisionAgentConfig,
  nodes: DecisionWorkflowNode[],
  edges: DecisionWorkflowEdge[]
): DecisionAgentConfig {
  const ordered = [...nodes].sort((a, b) => (a.x ?? 0) - (b.x ?? 0) || (a.y ?? 0) - (b.y ?? 0));
  const workflow = ordered.map((node, position) => ({ ...node, position }));
  const existing = new Map((config.decisions ?? []).map((unit) => [unit.id, unit]));
  const decisions: DecisionUnit[] = workflow
    .filter((node) => node.type === "decision")
    .map((node, index) => {
      const prior = existing.get(node.id);
      if (prior) {
        return { ...prior, title: node.name, description: node.description };
      }
      const created = newDecisionUnit(index);
      return {
        ...created,
        id: node.id,
        title: node.name,
        description: node.description,
        rules: created.rules.map((rule) => ({ ...rule, id: `${node.id}-${rule.outcome}` })),
      };
    })
    .filter((unit) => unit.title.trim().toLowerCase() !== "new decision");

  return {
    ...config,
    workflow,
    edges,
    decisions,
    rules: decisions.flatMap((unit) => unit.rules),
  };
}

export function updateDecisionRules(
  config: DecisionAgentConfig,
  unitId: string,
  rules: DecisionRule[]
): DecisionAgentConfig {
  const decisions = (config.decisions ?? []).map((unit) =>
    unit.id === unitId ? { ...unit, rules } : unit
  );
  return { ...config, decisions, rules: decisions.flatMap((unit) => unit.rules) };
}

export function isDecisionOutcome(value: string): value is DecisionOutcome {
  return value === "allow" || value === "review" || value === "block";
}
