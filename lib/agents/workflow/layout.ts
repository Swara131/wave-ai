import type { AgentWorkflowGraph, WorkflowGraphNode } from "./types";

const COL_X = 220;
const ROW_Y = 36;
const ROW_GAP = 210;

export function ensureNodeCoordinates(node: WorkflowGraphNode, index: number): WorkflowGraphNode {
  return {
    ...node,
    x: typeof node.x === "number" ? node.x : COL_X,
    y: typeof node.y === "number" ? node.y : ROW_Y + index * ROW_GAP,
  };
}

export function autoLayoutWorkflow(graph: AgentWorkflowGraph): AgentWorkflowGraph {
  const byPosition = [...graph.nodes].sort((a, b) => a.position - b.position);
  const nodes = byPosition.map((node, index) => ({
    ...node,
    position: index,
    x: COL_X,
    y: ROW_Y + index * ROW_GAP,
  }));
  return { ...graph, nodes };
}
