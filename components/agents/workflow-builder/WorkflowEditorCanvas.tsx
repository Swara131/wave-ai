"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import AddWorkflowNodeMenu from "@/components/agents/workflow-builder/AddWorkflowNodeMenu";
import WorkflowFlowNode, {
  type WorkflowRfNodeData,
} from "@/components/agents/workflow-builder/WorkflowFlowNode";
import WorkflowNodeConfigPanel from "@/components/agents/workflow-builder/WorkflowNodeConfigPanel";
import { autoLayoutWorkflow } from "@/lib/agents/workflow/layout";
import { duplicateWorkflowNode, normalizeWorkflowGraph } from "@/lib/agents/workflow/normalize";
import type { AgentWorkflowGraph, WorkflowGraphNode } from "@/lib/agents/workflow/types";

interface WorkflowEditorCanvasProps {
  graph: AgentWorkflowGraph | null;
  userEmail?: string | null;
  agentSlug?: string | null;
  runStatuses?: Record<string, "waiting" | "running" | "succeeded" | "failed" | "needs_approval">;
  onChange: (graph: AgentWorkflowGraph) => void;
}

const nodeTypes = { workflow: WorkflowFlowNode };

function toRfNodes(
  graph: AgentWorkflowGraph,
  runStatuses?: Record<string, "waiting" | "running" | "succeeded" | "failed" | "needs_approval">
): Node<WorkflowRfNodeData>[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    type: "workflow",
    position: { x: node.x ?? 72, y: node.y ?? 48 + node.position * 132 },
    data: { workflowNode: node, runStatus: runStatuses?.[node.id] },
  }));
}

function toRfEdges(graph: AgentWorkflowGraph): Edge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    label: edge.label,
    type: "smoothstep",
    animated: false,
  }));
}

function fromRf(
  graph: AgentWorkflowGraph,
  nodes: Node<WorkflowRfNodeData>[],
  edges: Edge[]
): AgentWorkflowGraph {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const nextNodes: WorkflowGraphNode[] = nodes.map((rf, index) => {
    const existing = byId.get(rf.id) ?? rf.data.workflowNode;
    return {
      ...existing,
      x: rf.position.x,
      y: rf.position.y,
      position: index,
    };
  });
  return normalizeWorkflowGraph({
    ...graph,
    nodes: nextNodes,
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
      label: typeof edge.label === "string" ? edge.label : undefined,
    })),
  });
}

function graphSignature(graph: AgentWorkflowGraph): string {
  return `${graph.nodes.map((node) => node.id).join(",")}|${graph.edges.map((edge) => edge.id).join(",")}`;
}

function CanvasInner({ graph, userEmail, agentSlug, runStatuses, onChange }: WorkflowEditorCanvasProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<WorkflowRfNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const history = useRef<AgentWorkflowGraph[]>([]);
  const future = useRef<AgentWorkflowGraph[]>([]);
  const signature = useRef("");

  useEffect(() => {
    if (!graph) return;
    const nextSig = graphSignature(graph);
    if (nextSig === signature.current) {
      setNodes((current) =>
        current.map((rf) => {
          const match = graph.nodes.find((item) => item.id === rf.id);
          return match
            ? { ...rf, data: { workflowNode: match, runStatus: runStatuses?.[match.id] } }
            : rf;
        })
      );
      return;
    }
    signature.current = nextSig;
    setNodes(toRfNodes(graph, runStatuses));
    setEdges(toRfEdges(graph));
  }, [graph, runStatuses, setEdges, setNodes]);

  const commit = useCallback((next: AgentWorkflowGraph) => {
    if (graph) {
      history.current = [...history.current.slice(-29), graph];
      future.current = [];
    }
    onChange(next);
  }, [graph, onChange]);

  const persistPositions = () => {
    if (!graph) return;
    onChange(fromRf(graph, nodes, edges));
  };

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!graph) return;
      const nextEdges = addEdge({ ...connection, id: `edge-${Date.now()}` }, edges);
      setEdges(nextEdges);
      commit(fromRf(graph, nodes, nextEdges));
    },
    [commit, edges, graph, nodes, setEdges]
  );

  const selectedNode = graph?.nodes.find((node) => node.id === selectedId) ?? null;
  const boardHeight = Math.max(
    1400,
    ...(graph?.nodes.map((node) => (node.y ?? 0) + 320) ?? [1400]),
    ...nodes.map((node) => node.position.y + 320)
  );

  const handleAdd = (node: WorkflowGraphNode) => {
    if (!graph) return;
    commit(normalizeWorkflowGraph({ ...graph, nodes: [...graph.nodes, node] }));
    setSelectedId(node.id);
  };

  const handleDelete = (nodeId: string) => {
    if (!graph) return;
    const node = graph.nodes.find((item) => item.id === nodeId);
    if (node?.category === "trigger") return;
    if (node?.type === "safety_approval" || node?.type === "safety_gate") {
      if (!window.confirm("Remove this safety checkpoint?")) return;
    }
    commit(
      normalizeWorkflowGraph({
        ...graph,
        nodes: graph.nodes.filter((item) => item.id !== nodeId),
        edges: graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      })
    );
    if (selectedId === nodeId) setSelectedId(null);
  };

  const handleSaveNode = (nodeId: string, patch: Partial<WorkflowGraphNode>) => {
    if (!graph) return;
    onChange({
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === nodeId ? { ...node, ...patch, config: patch.config ?? node.config } : node
      ),
    });
  };

  const undo = () => {
    const prev = history.current.pop();
    if (!prev || !graph) return;
    future.current.push(graph);
    onChange(prev);
  };

  const redo = () => {
    const next = future.current.pop();
    if (!next || !graph) return;
    history.current.push(graph);
    onChange(next);
  };

  if (!graph) {
    return (
      <div className="wfb-canvas wfb-canvas-empty">
        <p className="wfb-canvas-empty-title">Your workflow will appear here</p>
        <p className="wfb-canvas-empty-desc">
          Describe what you want on the left. Wave will generate an editable workflow from your
          prompt.
        </p>
      </div>
    );
  }

  return (
    <div className={`wfb-canvas-layout wf-rf-layout ${selectedNode ? "has-inspector" : ""}`}>
      <div className="wf-rf-shell">
        <div className="wfb-canvas-toolbar">
          <AddWorkflowNodeMenu onAdd={handleAdd} nextPosition={graph.nodes.length} />
          <div className="wfb-toolbar-actions">
            <button type="button" className="wfb-zoom-btn" onClick={undo}>
              Undo
            </button>
            <button type="button" className="wfb-zoom-btn" onClick={redo}>
              Redo
            </button>
            <button
              type="button"
              className="wfb-zoom-btn wfb-zoom-fit"
              onClick={() => commit(autoLayoutWorkflow(graph))}
            >
              Auto-layout
            </button>
            {selectedId ? (
              <button
                type="button"
                className="wfb-zoom-btn"
                onClick={() => commit(duplicateWorkflowNode(graph, selectedId))}
              >
                Duplicate
              </button>
            ) : null}
          </div>
        </div>
        <p className="wf-rf-hint">Click a box to select it, then drag to move. Drag a dot to connect boxes.</p>
        <div className="wf-rf-board" style={{ height: boardHeight }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={persistPositions}
            onNodeClick={(_event, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            onSelectionChange={({ nodes: selected }) => setSelectedId(selected[0]?.id ?? null)}
            nodesDraggable
            nodesConnectable
            elementsSelectable
            panOnDrag={[1, 2]}
            selectionOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch
            zoomOnDoubleClick={false}
            preventScrolling={false}
            defaultViewport={{ x: 48, y: 24, zoom: 1 }}
            minZoom={0.6}
            maxZoom={1.4}
            defaultEdgeOptions={{ type: "smoothstep", animated: false }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={22} color="rgba(148, 163, 184, 0.28)" />
          </ReactFlow>
        </div>
      </div>
      {selectedNode ? (
        <WorkflowNodeConfigPanel
          node={selectedNode}
          userEmail={userEmail}
          agentSlug={agentSlug}
          onSave={handleSaveNode}
          onDelete={handleDelete}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </div>
  );
}

export default function WorkflowEditorCanvas(props: WorkflowEditorCanvasProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="wfb-canvas wfb-canvas-empty">
        <p className="wfb-canvas-empty-title">Your workflow will appear here</p>
        <p className="wfb-canvas-empty-desc">
          Describe what you want on the left. Wave will generate an editable workflow from your
          prompt.
        </p>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
