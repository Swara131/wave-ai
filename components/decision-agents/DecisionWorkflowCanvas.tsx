"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plus } from "lucide-react";
import DecisionFlowNode, {
  type DecisionRfNodeData,
} from "@/components/decision-agents/DecisionFlowNode";
import DecisionNodeInspector from "@/components/decision-agents/DecisionNodeInspector";
import {
  applyCanvasToConfig,
  defaultDecisionEdges,
  layoutDecisionWorkflow,
  updateDecisionRules,
} from "@/lib/decision-agents/canvas-graph";
import type {
  DecisionAgentConfig,
  DecisionRule,
  DecisionWorkflowEdge,
  DecisionWorkflowNode,
} from "@/lib/decision-agents/types";

interface DecisionWorkflowCanvasProps {
  config: DecisionAgentConfig;
  onChange: (config: DecisionAgentConfig) => void;
}

const nodeTypes = { decision: DecisionFlowNode };

const EDGE_STYLE = {
  type: "smoothstep" as const,
  animated: false,
  style: { stroke: "#64748b", strokeWidth: 2 },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 18,
    height: 18,
    color: "#64748b",
  },
};

function toRfNodes(nodes: DecisionWorkflowNode[]): Node<DecisionRfNodeData>[] {
  return nodes.map((node) => ({
    id: node.id,
    type: "decision",
    draggable: true,
    selectable: true,
    connectable: true,
    position: { x: node.x ?? 48, y: node.y ?? 48 + node.position * 230 },
    data: { workflowNode: node },
  }));
}

function toRfEdges(edges: DecisionWorkflowEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    ...EDGE_STYLE,
  }));
}

function fromRf(nodes: Node<DecisionRfNodeData>[], edges: Edge[]): {
  nodes: DecisionWorkflowNode[];
  edges: DecisionWorkflowEdge[];
} {
  return {
    nodes: nodes.map((rf, index) => ({
      ...rf.data.workflowNode,
      x: rf.position.x,
      y: rf.position.y,
      position: index,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: typeof edge.label === "string" ? edge.label : undefined,
    })),
  };
}

function newBox(type: DecisionWorkflowNode["type"], index: number): DecisionWorkflowNode {
  const id = `${type}-${Date.now()}-${index}`;
  if (type === "input") {
    return { id, type, name: "New input", description: "Facts this step needs", position: index, x: 48, y: 80 };
  }
  if (type === "policy") {
    return { id, type, name: "Combine", description: "Join upstream decisions", position: index, x: 680, y: 80 };
  }
  if (type === "action") {
    return { id, type, name: "Output", description: "Show the result", position: index, x: 1000, y: 80 };
  }
  return {
    id,
    type: "decision",
    name: "New decision",
    description: "Click to name this judgment, then connect the dots.",
    position: index,
    x: 400,
    y: 48 + index * 230,
  };
}

function CanvasInner({ config, onChange }: DecisionWorkflowCanvasProps) {
  const { setViewport } = useReactFlow();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<DecisionRfNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const signature = useRef("");

  const workflow = config.workflow;
  const graphEdges = useMemo(
    () => (config.edges?.length ? config.edges : defaultDecisionEdges(workflow)),
    [config.edges, workflow]
  );

  useEffect(() => {
    const nextSig = `${workflow.map((node) => node.id).join(",")}|${graphEdges.map((edge) => edge.id).join(",")}`;
    if (nextSig === signature.current) {
      setNodes((current) =>
        current.map((rf) => {
          const match = workflow.find((item) => item.id === rf.id);
          return match ? { ...rf, data: { workflowNode: match } } : rf;
        })
      );
      return;
    }
    signature.current = nextSig;
    setNodes(toRfNodes(workflow));
    setEdges(toRfEdges(graphEdges));
  }, [workflow, graphEdges, setEdges, setNodes]);

  const commit = useCallback(
    (nextNodes: DecisionWorkflowNode[], nextEdges: DecisionWorkflowEdge[]) => {
      onChange(applyCanvasToConfig(config, nextNodes, nextEdges));
    },
    [config, onChange]
  );

  const persistPositions = () => {
    const next = fromRf(nodes, edges);
    commit(next.nodes, next.edges);
  };

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return;
      const nextEdges = addEdge({ ...connection, id: `edge-${Date.now()}`, ...EDGE_STYLE }, edges);
      setEdges(nextEdges);
      commit(fromRf(nodes, nextEdges).nodes, fromRf(nodes, nextEdges).edges);
    },
    [commit, edges, nodes, setEdges]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const next = applyEdgeChanges(changes, edges);
      onEdgesChange(changes);
      if (changes.some((change) => change.type === "remove")) {
        commit(fromRf(nodes, next).nodes, fromRf(nodes, next).edges);
      }
    },
    [commit, edges, nodes, onEdgesChange]
  );

  const selectedNode = workflow.find((node) => node.id === selectedId) ?? null;
  const boardHeight = Math.max(
    1100,
    ...workflow.map((node) => (node.y ?? 0) + 340),
    ...nodes.map((node) => node.position.y + 340)
  );

  const handleAddBox = (type: DecisionWorkflowNode["type"]) => {
    const count = workflow.filter((node) => node.type === type).length;
    const node = newBox(type, count);
    const lastSame = [...workflow].filter((item) => item.type === type).pop();
    node.x = lastSame ? (lastSame.x ?? node.x) : node.x;
    node.y = lastSame ? (lastSame.y ?? 48) + 230 : node.y;
    commit([...workflow, node], graphEdges);
    setSelectedId(node.id);
  };

  const handleDelete = (nodeId: string) => {
    const nextNodes = workflow.filter((node) => node.id !== nodeId);
    const nextEdges = graphEdges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
    commit(nextNodes, nextEdges);
    if (selectedId === nodeId) setSelectedId(null);
  };

  const handlePatchNode = (nodeId: string, patch: Partial<DecisionWorkflowNode>) => {
    const nextNodes = workflow.map((node) => (node.id === nodeId ? { ...node, ...patch } : node));
    onChange(applyCanvasToConfig(config, nextNodes, graphEdges));
  };

  const handlePatchRules = (unitId: string, rules: DecisionRule[]) => {
    onChange(updateDecisionRules(config, unitId, rules));
  };

  return (
    <div className={`zdec-flow-canvas wf-rf-layout ${selectedNode ? "has-inspector" : ""}`}>
      <div className="zdec-flow-shell">
        <div className="zdec-flow-toolbar">
          <div className="zdec-flow-add">
            <button type="button" onClick={() => handleAddBox("input")}>
              <Plus className="h-4 w-4" /> Input
            </button>
            <button type="button" onClick={() => handleAddBox("decision")}>
              <Plus className="h-4 w-4" /> Decision
            </button>
            <button type="button" onClick={() => handleAddBox("policy")}>
              <Plus className="h-4 w-4" /> Combine
            </button>
            <button type="button" onClick={() => handleAddBox("action")}>
              <Plus className="h-4 w-4" /> Output
            </button>
          </div>
          <div className="zdec-flow-tools">
            <button
              type="button"
              onClick={() =>
                commit(layoutDecisionWorkflow(workflow), graphEdges)
              }
            >
              Align
            </button>
            <button type="button" onClick={() => void setViewport({ x: 24, y: 24, zoom: 1 })}>
              Reset view
            </button>
          </div>
        </div>
        <p className="zdec-flow-hint">
          Click a box to select it, drag to move. Drag a dot to draw an arrow to another box.
        </p>
        <div className="zdec-flow-board" style={{ height: boardHeight }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={persistPositions}
            onNodeClick={(_event, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            nodesDraggable
            nodesConnectable
            elementsSelectable
            panOnDrag={[1, 2]}
            selectionOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch
            zoomOnDoubleClick={false}
            preventScrolling={false}
            defaultViewport={{ x: 24, y: 16, zoom: 1 }}
            minZoom={0.6}
            maxZoom={1.4}
            deleteKeyCode={["Backspace", "Delete"]}
            connectionLineStyle={{ stroke: "#818cf8", strokeWidth: 2 }}
            defaultEdgeOptions={EDGE_STYLE}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} color="rgba(148, 163, 184, 0.22)" />
          </ReactFlow>
        </div>
      </div>
      {selectedNode ? (
        <DecisionNodeInspector
          node={selectedNode}
          config={config}
          onPatchNode={handlePatchNode}
          onPatchRules={handlePatchRules}
          onDelete={handleDelete}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </div>
  );
}

export default function DecisionWorkflowCanvas(props: DecisionWorkflowCanvasProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="studio-workflow-empty">Opening canvas…</div>;
  }

  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
