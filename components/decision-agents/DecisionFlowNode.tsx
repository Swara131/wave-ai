"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { DecisionWorkflowNode } from "@/lib/decision-agents/types";

export type DecisionRfNodeData = {
  workflowNode: DecisionWorkflowNode;
};

function toneClass(type: string): string {
  if (type === "input") return "is-trigger";
  if (type === "decision") return "is-logic";
  if (type === "policy") return "is-approval";
  if (type === "action") return "is-output";
  return "is-data";
}

function kicker(type: string): string {
  if (type === "input") return "Input";
  if (type === "decision") return "Decision";
  if (type === "policy") return "Combine";
  if (type === "action") return "Output";
  return type;
}

export default function DecisionFlowNode({ data, selected }: NodeProps) {
  const node = (data as DecisionRfNodeData).workflowNode;
  return (
    <div className={`zdec-box ${toneClass(node.type)} ${selected ? "is-selected" : ""}`}>
      <Handle
        type="target"
        position={Position.Left}
        className="zdec-dot zdec-dot-in"
        aria-label={`Connect into ${node.name}`}
      />
      <p className="zdec-box-kicker">{kicker(node.type)}</p>
      <p className="zdec-box-title">{node.name}</p>
      <p className="zdec-box-desc">{node.description}</p>
      <Handle
        type="source"
        position={Position.Right}
        className="zdec-dot zdec-dot-out"
        aria-label={`Connect from ${node.name}`}
      />
    </div>
  );
}
