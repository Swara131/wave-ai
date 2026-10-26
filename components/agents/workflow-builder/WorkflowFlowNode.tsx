"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { WorkflowGraphNode } from "@/lib/agents/workflow/types";

export type WorkflowRfNodeData = {
  workflowNode: WorkflowGraphNode;
  runStatus?: "waiting" | "running" | "succeeded" | "failed" | "needs_approval";
};

function toneClass(node: WorkflowGraphNode): string {
  if (node.type === "safety_approval") return "is-approval";
  if (node.type === "safety_error") return "is-error";
  return `is-${node.category}`;
}

export default function WorkflowFlowNode({ data, selected }: NodeProps) {
  const node = (data as WorkflowRfNodeData).workflowNode;
  const runStatus = (data as WorkflowRfNodeData).runStatus;
  return (
    <div
      className={`wf-rf-node ${toneClass(node)} ${selected ? "is-selected" : ""} ${runStatus ? `is-run-${runStatus}` : ""}`}
    >
      {runStatus === "running" ? <span className="wf-rf-pulse" aria-hidden="true" /> : null}
      <Handle type="target" position={Position.Top} aria-label={`${node.name} input`} />
      <p className="wf-rf-kicker">
        {node.category}
        {runStatus === "succeeded"
          ? " · Completed"
          : runStatus === "running"
            ? " · Running"
            : runStatus === "failed"
              ? " · Failed"
              : runStatus === "needs_approval"
                ? " · Waiting for approval"
                : ""}
      </p>
      <p className="wf-rf-title">{node.name}</p>
      <p className="wf-rf-desc">{node.description}</p>
      {node.config.permissionLevel ? (
        <p className="wf-rf-perm">{node.config.permissionLevel.replaceAll("_", " ")}</p>
      ) : null}
      <Handle type="source" position={Position.Bottom} aria-label={`${node.name} output`} />
    </div>
  );
}
