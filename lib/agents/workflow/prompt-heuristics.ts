/**
 * Deterministic prompt → workflow fallback.
 * Used when keyword patterns should produce a richer graph than the generic tool list.
 * Not shown as a fallback in the product UI.
 */
import { autoLayoutWorkflow } from "./layout";
import type { AgentWorkflowGraph, WorkflowGraphEdge, WorkflowGraphNode } from "./types";

function nid(prefix: string, index: number): string {
  return `${prefix}-${index}`;
}

function node(
  partial: Omit<WorkflowGraphNode, "status" | "position" | "x" | "y"> & { position: number }
): WorkflowGraphNode {
  return { ...partial, status: "valid", x: 72, y: 48 + partial.position * 132 };
}

function edgesLinear(nodes: WorkflowGraphNode[]): WorkflowGraphEdge[] {
  return nodes.slice(0, -1).map((item, index) => ({
    id: `edge-${index}`,
    source: item.id,
    target: nodes[index + 1]!.id,
  }));
}

export function promptLooksLikeLeadOutreach(prompt: string): boolean {
  const text = prompt.toLowerCase();
  return (
    (/\blead/.test(text) || /\boutreach/.test(text) || /\bqualif/.test(text)) &&
    (/\bemail/.test(text) || /\bapprov/.test(text) || /\bscore/.test(text))
  );
}

export function generateLeadOutreachWorkflow(goal: string): AgentWorkflowGraph {
  const nodes: WorkflowGraphNode[] = [
    node({
      id: nid("trigger", 0),
      type: "trigger_form",
      category: "trigger",
      name: "New lead",
      description: "Form or CRM lead received",
      config: { triggerType: "webhook" },
      position: 0,
    }),
    node({
      id: nid("safety", 0),
      type: "safety_validation",
      category: "safety",
      name: "Validate input",
      description: "Check required fields before research",
      config: {},
      position: 1,
    }),
    node({
      id: nid("tool", 0),
      type: "tool",
      category: "tool",
      name: "Research contact",
      description: "Research company and contact",
      config: { toolName: "web_search", permissionLevel: "read_only" },
      position: 2,
    }),
    node({
      id: nid("ai", 0),
      type: "ai_score",
      category: "ai",
      name: "Score lead",
      description: "AI qualification against your threshold",
      config: { goal },
      position: 3,
    }),
    node({
      id: nid("logic", 0),
      type: "condition",
      category: "logic",
      name: "Score above threshold?",
      description: "Continue only for qualified leads",
      config: { condition: { expression: "lead_score >= threshold" } },
      position: 4,
    }),
    node({
      id: nid("ai", 1),
      type: "ai_generation",
      category: "ai",
      name: "Draft outreach",
      description: "Write a personalized email (draft only)",
      config: { permissionLevel: "draft_only" },
      position: 5,
    }),
    node({
      id: nid("safety", 1),
      type: "safety_approval",
      category: "safety",
      name: "Human approval",
      description: "Send only after you approve",
      config: { permissionLevel: "ask_approval" },
      position: 6,
    }),
    node({
      id: nid("tool", 1),
      type: "tool",
      category: "tool",
      name: "Send email",
      description: "Send the approved outreach",
      config: { toolName: "send_email", permissionLevel: "ask_approval" },
      position: 7,
    }),
    node({
      id: nid("out", 0),
      type: "output_response",
      category: "output",
      name: "Log outcome",
      description: "Store result for audit",
      config: {},
      position: 8,
    }),
    node({
      id: nid("safety", 2),
      type: "safety_error",
      category: "safety",
      name: "Notify on failure",
      description: "Escalate if a step fails",
      config: {},
      position: 9,
    }),
  ];

  return autoLayoutWorkflow({
    version: 1,
    nodes,
    edges: edgesLinear(nodes),
  });
}

/** Keyword-only graph when interpretation is unavailable. */
export function generateWorkflowFromPromptFallback(prompt: string): AgentWorkflowGraph {
  const trimmed = prompt.trim();
  if (promptLooksLikeLeadOutreach(trimmed)) {
    return generateLeadOutreachWorkflow(trimmed);
  }

  const wantsEmail = /\bemail|\bmail/.test(trimmed.toLowerCase());
  const wantsLink =
    /\byoutube|\byoutu\.be|\btiktok|\binstagram|\bvideo|\burl|\blink/.test(trimmed.toLowerCase());
  const wantsSearch = /\bsearch|\bresearch|\bnews|\bweb/.test(trimmed.toLowerCase());
  const nodes: WorkflowGraphNode[] = [
    node({
      id: nid("trigger", 0),
      type: "trigger_manual",
      category: "trigger",
      name: "Manual trigger",
      description: "Run when you start the agent",
      config: { triggerType: "webhook" },
      position: 0,
    }),
    node({
      id: nid("ai", 0),
      type: "ai_reasoning",
      category: "ai",
      name: "AI task",
      description: trimmed.slice(0, 180) || "Follow the user goal",
      config: { goal: trimmed, instructions: trimmed },
      position: 1,
    }),
  ];

  if (wantsLink) {
    nodes.push(
      node({
        id: nid("tool", 0),
        type: "tool",
        category: "tool",
        name: "Read link",
        description: "Fetch the YouTube or web page the user provides",
        config: { toolName: "fetch_url", permissionLevel: "read_only" },
        position: nodes.length,
      })
    );
  } else if (wantsSearch) {
    nodes.push(
      node({
        id: nid("tool", 0),
        type: "tool",
        category: "tool",
        name: "Web research",
        description: "Search the web",
        config: { toolName: "web_search", permissionLevel: "read_only" },
        position: nodes.length,
      })
    );
  }

  nodes.push(
    node({
      id: nid("safety", 0),
      type: "safety_gate",
      category: "safety",
      name: "Safety gate",
      description: "Policy, permissions, and approval checks",
      config: {},
      position: nodes.length,
    })
  );

  if (wantsEmail) {
    nodes.push(
      node({
        id: nid("tool", 1),
        type: "tool",
        category: "tool",
        name: "Send email",
        description: "Send only after policy checks",
        config: { toolName: "send_email", permissionLevel: "ask_approval" },
        position: nodes.length,
      })
    );
  } else {
    nodes.push(
      node({
        id: nid("out", 0),
        type: "output_response",
        category: "output",
        name: "Complete",
        description: "Finish and store results",
        config: {},
        position: nodes.length,
      })
    );
  }

  nodes.forEach((item, index) => {
    item.position = index;
  });

  return autoLayoutWorkflow({ version: 1, nodes, edges: edgesLinear(nodes) });
}
