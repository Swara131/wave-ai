import type { AgentInterpretation } from "@/lib/agents/builder-types";
import { labelAgentTool } from "@/lib/agents/tool-labels";
import { resolveToolName } from "@/lib/agents/tools/catalog";
import { autoLayoutWorkflow } from "./layout";
import { getNodeDefinition, orderToolsLogically } from "./node-definitions";
import {
  generateLeadOutreachWorkflow,
  promptLooksLikeLeadOutreach,
} from "./prompt-heuristics";
import type {
  AgentWorkflowGraph,
  WorkflowGraphEdge,
  WorkflowGraphNode,
} from "./types";

function createId(prefix: string, index: number): string {
  return `${prefix}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

function triggerNodeFromInterpretation(
  interpretation: AgentInterpretation
): WorkflowGraphNode {
  const triggerType = interpretation.triggerType;
  let type: WorkflowGraphNode["type"] = "trigger_manual";
  if (triggerType === "schedule") type = "trigger_schedule";
  if (triggerType === "webhook") type = "trigger_webhook";
  if (triggerType === "email") type = "trigger_webhook";

  const definition = getNodeDefinition(type);
  return {
    id: createId("trigger", 0),
    type,
    category: "trigger",
    name: definition?.label ?? "Trigger",
    description: interpretation.scheduleSummary || "When the agent runs",
    config: {
      triggerType: interpretation.triggerType,
      schedule: {
        ...interpretation.schedule,
        timezone: interpretation.timezone,
      },
    },
    status: "valid",
    position: 0,
  };
}

function toolNode(toolName: string, index: number, goal: string): WorkflowGraphNode {
  const resolved = resolveToolName(toolName);
  const definition = getNodeDefinition("tool", resolved);
  return {
    id: createId("tool", index),
    type: "tool",
    category: "tool",
    name: definition?.label ?? labelAgentTool(resolved),
    description: inferToolStepDescription(resolved, goal),
    config: {
      toolName: resolved,
      capabilityId: definition?.capabilityId,
    },
    status: "idle",
    position: index,
  };
}

function inferToolStepDescription(toolName: string, goal: string): string {
  const normalizedGoal = goal.toLowerCase();
  switch (toolName) {
    case "web_search":
      return normalizedGoal.includes("news")
        ? "Find the latest relevant articles"
        : "Search the web for relevant information";
    case "send_email":
      return "Send the results to your inbox";
    case "read_document":
      return "Read uploaded documents";
    case "google_sheets":
      return "Google Sheets is no longer supported — use CSV upload instead";
    case "http_request":
      return "Call an external API";
    case "issue_refund":
      return "Process refund requests within policy limits";
    case "send_whatsapp_message":
      return "Send a WhatsApp notification";
    default:
      return `Run ${labelAgentTool(toolName)}`;
  }
}

function outputNodeFromInterpretation(
  interpretation: AgentInterpretation,
  position: number
): WorkflowGraphNode {
  if (interpretation.deliveryMode === "email" || interpretation.deliveryMode === "both") {
    return {
      id: createId("output", position),
      type: "output_email",
      category: "output",
      name: "Send email",
      description: "Deliver workflow results by email",
      config: {
        email: {
          sendMode: "after_workflow",
        },
      },
      status: "idle",
      position,
    };
  }

  if (interpretation.deliveryMode === "notification") {
    return {
      id: createId("output", position),
      type: "output_notification",
      category: "output",
      name: "Notification",
      description: "Notify you in Wave",
      config: {},
      status: "valid",
      position,
    };
  }

  return {
    id: createId("output", position),
    type: "output_response",
    category: "output",
    name: "Complete",
    description: "Finish and store results",
    config: {},
    status: "valid",
    position,
  };
}

function shouldInsertSummarizeStep(tools: string[], goal: string): boolean {
  const hasSearch = tools.includes("web_search") || tools.includes("x_search");
  const hasEmailOrNotify =
    tools.includes("send_email") ||
    tools.includes("send_whatsapp_message") ||
    /\bsummar/i.test(goal);
  return hasSearch && hasEmailOrNotify;
}

function linearEdges(nodes: WorkflowGraphNode[]): WorkflowGraphEdge[] {
  const edges: WorkflowGraphEdge[] = [];
  for (let index = 0; index < nodes.length - 1; index += 1) {
    edges.push({
      id: `edge-${index}`,
      source: nodes[index]!.id,
      target: nodes[index + 1]!.id,
    });
  }
  return edges;
}

export function generateWorkflowFromInterpretation(
  interpretation: AgentInterpretation
): AgentWorkflowGraph {
  const nodes: WorkflowGraphNode[] = [];
  let position = 0;

  nodes.push({ ...triggerNodeFromInterpretation(interpretation), position: position++ });

  nodes.push({
    id: createId("ai", 0),
    type: "ai_reasoning",
    category: "ai",
    name: interpretation.displayName,
    description: interpretation.goal,
    config: {
      goal: interpretation.goal,
      instructions: interpretation.instructions,
    },
    status: "valid",
    position: position++,
  });

  const orderedTools = orderToolsLogically(interpretation.tools);

  if (shouldInsertSummarizeStep(orderedTools, interpretation.goal)) {
    const searchTools = orderedTools.filter(
      (tool) => tool === "web_search" || tool === "x_search"
    );
    const otherTools = orderedTools.filter(
      (tool) => tool !== "web_search" && tool !== "x_search"
    );

    for (const [index, toolName] of searchTools.entries()) {
      nodes.push(toolNode(toolName, index, interpretation.goal));
      position += 1;
    }

    nodes.push({
      id: createId("ai", 1),
      type: "ai_generation",
      category: "ai",
      name: "Summarize",
      description: "Summarize and rank the collected results",
      config: {
        goal: interpretation.goal,
        instructions: interpretation.instructions,
      },
      status: "valid",
      position: position++,
    });

    for (const [index, toolName] of otherTools.entries()) {
      nodes.push(toolNode(toolName, index + searchTools.length, interpretation.goal));
      position += 1;
    }
  } else {
    for (const [index, toolName] of orderedTools.entries()) {
      nodes.push(toolNode(toolName, index, interpretation.goal));
      position += 1;
    }
  }

  nodes.push({
    id: createId("safety", 0),
    type: "safety_gate",
    category: "safety",
    name: "Safety gate",
    description: interpretation.protectionSummary || "Wave policy and risk checks",
    config: {},
    status: "valid",
    position: position++,
  });

  const output = outputNodeFromInterpretation(interpretation, position);
  const hasEmailTool = orderedTools.includes("send_email");
  if (output.type === "output_email" && hasEmailTool) {
    // Email delivery is represented by the send_email tool step.
  } else {
    nodes.push(output);
  }

  nodes.forEach((item, index) => {
    item.position = index;
  });

  const text = `${interpretation.originalDescription} ${interpretation.goal}`;
  if (promptLooksLikeLeadOutreach(text)) {
    return generateLeadOutreachWorkflow(interpretation.goal);
  }

  return autoLayoutWorkflow({
    version: 1,
    nodes,
    edges: linearEdges(nodes),
  });
}

export function generateWorkflowFromAgent(params: {
  name: string;
  goal?: string | null;
  instructions?: string | null;
  tools?: string[];
  scheduleSummary?: string | null;
  triggerType?: string;
  schedule?: import("../runtime-types").AgentScheduleConfig;
  timezone?: string;
  deliveryMode?: import("../delivery/types").AgentDeliveryMode;
  protectionSummary?: string;
}): AgentWorkflowGraph {
  const tools = params.tools ?? [];
  const fakeInterpretation: AgentInterpretation = {
    displayName: params.name,
    goal: params.goal ?? params.name,
    instructions: params.instructions ?? params.goal ?? "",
    scheduleSummary: params.scheduleSummary ?? "When you run it",
    schedule: params.schedule ?? { when: "manual", triggerType: "webhook" },
    timezone: params.timezone ?? "UTC",
    capabilityIds: [],
    capabilities: [],
    tools,
    protectionSummary: params.protectionSummary ?? "Wave Protection enabled",
    triggerType:
      params.triggerType === "schedule" || params.triggerType === "email"
        ? params.triggerType
        : "webhook",
    suggestedThreshold: 5000,
    originalDescription: params.goal ?? params.name,
    deliveryMode: params.deliveryMode ?? "notification",
  };

  return generateWorkflowFromInterpretation(fakeInterpretation);
}
