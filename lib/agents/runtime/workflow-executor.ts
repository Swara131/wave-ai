import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkflowGraphNode } from "@/lib/agents/workflow/types";
import { isTwilioWhatsAppConfigured } from "@/lib/whatsapp/env";
import { summarizeToolResultsForTask } from "./model/summarize-results";
import { formatQueryToolReport } from "./analysis/structured-report";
import type { RecordAnalysisResult } from "./analysis/record-validation";
import { deriveWebSearchQuery } from "./model/task-intent";
import { resolveDatabaseQueryInput } from "./data/resolve-query-source";
import {
  parseDeliverySettings,
  shouldBlockExternalDeliveryTools,
} from "@/lib/agents/delivery/settings";
import {
  destinationEmailFromAgent,
  destinationPhoneFromAgent,
  setupAnswersFromAgent,
  workflowGraphFromAgent,
  workflowPlanFromGraph,
} from "./execution-plan";
import { resolveToolName } from "@/lib/agents/tools/catalog";
import { extractHttpUrl } from "@/lib/http/outbound-url";
import { executeProtectedTool } from "./protected-tool";
import { completeAiWorkflowStep, isAiWorkflowNode } from "./workflow-ai-step";
import type { RuntimeActivityLogger } from "./activity/activity-logger";
import type { LoadedAgent, RunAgentResult, RuntimeLimits } from "./types";
import type { SourceImage } from "./source-image";
import type { ConceptImage } from "./concept-image";

function sortedNodes(agent: LoadedAgent): WorkflowGraphNode[] {
  const graph = workflowGraphFromAgent(agent.record);
  if (!graph?.nodes?.length) return [];
  return [...graph.nodes].sort((a, b) => a.position - b.position);
}

export function agentHasPersistedWorkflow(agent: LoadedAgent): boolean {
  return workflowPlanFromGraph(workflowGraphFromAgent(agent.record)).length > 0;
}

export function toolInputForNode(params: {
  node: WorkflowGraphNode;
  agent: LoadedAgent;
  task: string;
  summary: string;
}): Record<string, unknown> | null {
  const toolName = resolveToolName(
    params.node.config.toolName ??
      (params.node.type === "output_email" ? "send_email" : "")
  );
  if (!toolName) return null;

  const answers = setupAnswersFromAgent(params.agent.record);

  if (toolName === "fetch_url") {
    const url = answers.source_url || extractHttpUrl(params.task) || "";
    if (!url) return { missing: "source_url" };
    return { url };
  }

  if (toolName === "web_search" || toolName === "x_search") {
    return { query: deriveWebSearchQuery(params.task, params.agent), count: 5 };
  }

  if (toolName === "send_email") {
    const to = destinationEmailFromAgent(params.agent.record);
    if (!to) return { missing: "email" };
    return {
      to,
      subject: `${params.agent.record.name} result`,
      message: params.summary || "No analysis result was produced yet.",
    };
  }

  if (toolName === "send_whatsapp_message") {
    if (!isTwilioWhatsAppConfigured()) return { missing: "whatsapp_provider" };
    const to = destinationPhoneFromAgent(params.agent.record);
    if (!to) return { missing: "whatsapp" };
    return { to, message: params.summary || "No analysis result was produced yet." };
  }

  if (toolName === "query_supabase") {
    return resolveDatabaseQueryInput({
      agent: params.agent,
      task: params.task,
    });
  }

  if (toolName === "read_document") {
    return { documentId: "latest" };
  }

  if (toolName === "update_crm_record") {
    return {
      ...answers,
      recordId: answers.ticket_id || answers.record_id || answers.customer_id,
      fields: answers,
    };
  }

  if (toolName === "delete_crm_record") {
    return {
      customerId: answers.customer_id || answers.customerId || answers.record_id,
    };
  }

  return { ...answers, task: params.task, summary: params.summary };
}

function isExecutableToolNode(node: WorkflowGraphNode): boolean {
  if (isAiWorkflowNode(node)) return false;
  return Boolean(
    node.config.toolName || node.type === "output_email" || node.type === "tool"
  );
}

function isDeliveryTool(toolName: string): boolean {
  return toolName === "send_email" || toolName === "send_whatsapp_message";
}

export async function runPersistedWorkflow(params: {
  admin: SupabaseClient;
  agent: LoadedAgent;
  userId: string;
  task: string;
  runId: string | null;
  limits: RuntimeLimits;
  activity: RuntimeActivityLogger;
  startNodeIndex?: number;
  initialSummary?: string;
  initialLastToolName?: string | null;
  initialLastToolOutput?: Record<string, unknown>;
  initialToolCalls?: number;
  initialActionSequence?: number;
  sourceImage?: SourceImage;
}): Promise<RunAgentResult> {
  const nodes = sortedNodes(params.agent);
  let summary = params.initialSummary ?? "";
  let conceptImages: ConceptImage[] = [];
  let generationError: string | undefined;
  let generationProvider: string | undefined;
  let generationModel: string | undefined;
  let generationErrorKind: string | undefined;
  let generationRetryable: boolean | undefined;
  let analysis: RecordAnalysisResult | undefined;
  let lastToolName: string | null = params.initialLastToolName ?? null;
  let lastToolOutput: Record<string, unknown> = params.initialLastToolOutput ?? {};
  let toolCalls = params.initialToolCalls ?? 0;
  let actionSequence = params.initialActionSequence ?? 0;
  let deliveredEmail = false;
  let deliveredWhatsApp = false;
  let emailMessageId: string | null = null;
  let emailTo: string | null = null;
  let whatsappMessageId: string | null = null;
  const turns = 1;

  const startIndex = Math.max(0, params.startNodeIndex ?? 0);
  const sourceUrl =
    setupAnswersFromAgent(params.agent.record).source_url || extractHttpUrl(params.task) || "";
  const graphHasFetch = nodes.some(
    (node) => resolveToolName(node.config.toolName ?? "") === "fetch_url"
  );

  if (sourceUrl && params.agent.enabledTools.includes("fetch_url") && !graphHasFetch && startIndex === 0) {
    actionSequence += 1;
    const fetched = await executeProtectedTool({
      admin: params.admin,
      agent: params.agent,
      userId: params.userId,
      runId: params.runId,
      task: params.task,
      toolName: "fetch_url",
      toolInput: { url: sourceUrl },
      activity: params.activity,
      toolCalls,
      actionSequence,
      turns,
      maxRetries: params.limits.maxRetries,
      workflowNodeIndex: 0,
      lastToolName,
      lastToolOutput,
      summary,
    });
    if (fetched.kind === "awaiting_approval" || fetched.kind === "failed") {
      return fetched.result;
    }
    if (fetched.kind === "blocked") {
      await params.activity.finishRun({
        runId: params.runId,
        status: "failed",
        summary: null,
        errorMessage: fetched.reason,
      });
      return {
        runId: params.runId,
        status: "failed",
        summary: null,
        error: fetched.reason,
        proposalId: null,
        toolCalls: fetched.toolCalls,
        turns,
        steps: params.activity.getSteps(),
      };
    }
    toolCalls = fetched.toolCalls;
    lastToolName = "fetch_url";
    lastToolOutput = fetched.outcome.output;
    if (!fetched.outcome.executed) {
      const error =
        "error" in fetched.outcome
          ? fetched.outcome.error
          : "Wave could not read that link.";
      await params.activity.finishRun({
        runId: params.runId,
        status: "failed",
        summary: null,
        errorMessage: error,
      });
      return {
        runId: params.runId,
        status: "failed",
        summary: null,
        error,
        proposalId: null,
        toolCalls,
        turns,
        steps: params.activity.getSteps(),
      };
    }
    summary = await summarizeToolResultsForTask({
      task: params.task,
      agentName: params.agent.record.name,
      toolName: "fetch_url",
      toolOutput: lastToolOutput,
      agentRecord: params.agent.record,
    });
  }

  for (let nodeIndex = startIndex; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = nodes[nodeIndex];
    await params.activity.logRunStep({
      runId: params.runId,
      key: `workflow.${node.id}`,
      label: node.name,
      detail: node.description,
      status: "running",
    });

    if (node.category === "trigger" || node.category === "safety" || node.category === "logic") {
      await params.activity.logRunStep({
        runId: params.runId,
        key: `workflow.${node.id}.done`,
        label: `${node.name} ✓`,
        detail: node.category === "safety" ? "Policy checks run with each tool" : node.description,
      });
      continue;
    }

    if (isAiWorkflowNode(node)) {
      if (lastToolName === "query_supabase" || lastToolName === "query_database") {
        const formatted = formatQueryToolReport({
          toolOutput: lastToolOutput,
          agent: params.agent.record,
          task: params.task,
        });
        summary = formatted.text;
        analysis = formatted.analysis;
      } else if (lastToolName && Object.keys(lastToolOutput).length > 0) {
        summary = await summarizeToolResultsForTask({
          task: params.task,
          agentName: params.agent.record.name,
          toolName: lastToolName,
          toolOutput: lastToolOutput,
          agentRecord: params.agent.record,
        });
      }
      if (!summary.trim()) {
        const step = await completeAiWorkflowStep({
          task: params.task,
          agent: params.agent.record,
          lastToolName,
          lastToolOutput,
          existingSummary: summary,
          sourceImage: params.sourceImage,
        });
        summary = step.summary;
        if (step.conceptImages.length) conceptImages = step.conceptImages;
        generationError = step.generationError;
        generationProvider = step.generationProvider;
        generationModel = step.generationModel;
        generationErrorKind = step.generationErrorKind;
        generationRetryable = step.generationRetryable;
      }
      await params.activity.logRunStep({
        runId: params.runId,
        key: `workflow.${node.id}.done`,
        label: `${node.name} ✓`,
        detail: summary.slice(0, 180),
      });
      continue;
    }

    if (node.category === "output" && !isExecutableToolNode(node)) {
      await params.activity.logRunStep({
        runId: params.runId,
        key: `workflow.${node.id}.done`,
        label: `${node.name} ✓`,
        detail: summary ? summary.slice(0, 180) : "Result stays in Wave.",
      });
      continue;
    }

    if (!isExecutableToolNode(node)) {
      continue;
    }

    const toolName = resolveToolName(
      node.config.toolName ?? (node.type === "output_email" ? "send_email" : "")
    );
    if (
      sourceUrl &&
      (toolName === "query_supabase" || toolName === "query_database" || toolName === "read_document")
    ) {
      await params.activity.logRunStep({
        runId: params.runId,
        key: `workflow.${node.id}.skipped`,
        label: `${node.name} skipped`,
        detail: "This run is summarizing a provided link, so ticket or file sources were not queried.",
      });
      continue;
    }
    const delivery = parseDeliverySettings(params.agent.record.safetySettings);
    if (isDeliveryTool(toolName) && shouldBlockExternalDeliveryTools(delivery.mode)) {
      await params.activity.logRunStep({
        runId: params.runId,
        key: `workflow.${node.id}.skipped`,
        label: `${node.name} skipped`,
        detail: "Results stay in Wave. Email and WhatsApp are not sent for this agent.",
      });
      continue;
    }
    if (!toolName) {
      await params.activity.logRunStep({
        runId: params.runId,
        key: `workflow.${node.id}.skipped`,
        label: `${node.name} skipped`,
        detail: "This step has no executable tool, so Wave continued to the result.",
      });
      continue;
    }
    if (!params.agent.enabledTools.includes(toolName)) {
      const error = `${node.name} could not run because ${toolName} is not enabled for this agent.`;
      await params.activity.finishRun({
        runId: params.runId,
        status: "failed",
        summary: summary || null,
        errorMessage: error,
      });
      return {
        runId: params.runId,
        status: "failed",
        summary: summary || null,
        error,
        proposalId: null,
        toolCalls,
        turns,
        steps: params.activity.getSteps(),
      };
    }
    if (isDeliveryTool(toolName) && !summary.trim()) {
      const step = await completeAiWorkflowStep({
        task: params.task,
        agent: params.agent.record,
        lastToolName,
        lastToolOutput,
        existingSummary: summary,
        sourceImage: params.sourceImage,
      });
      summary = step.summary;
      if (step.conceptImages.length) conceptImages = step.conceptImages;
      generationError = step.generationError;
      generationProvider = step.generationProvider;
      generationModel = step.generationModel;
      generationErrorKind = step.generationErrorKind;
      generationRetryable = step.generationRetryable;
    }

    const toolInput = toolInputForNode({
      node,
      agent: params.agent,
      task: params.task,
      summary,
    });
    if (!toolInput || typeof toolInput.missing === "string") {
      const error =
        toolInput?.missing === "whatsapp_provider"
          ? "WhatsApp is required for this agent, but no WhatsApp provider is connected."
          : toolInput?.missing === "whatsapp"
            ? "WhatsApp is required for this agent, but no recipient is configured."
            : toolInput?.missing === "source_url"
              ? "This agent needs a public link (YouTube, article, or other page) before it can run. Wave will not invent a summary."
              : "Email is required for this agent, but no recipient is configured.";
      await params.activity.finishRun({
        runId: params.runId,
        status: "failed",
        summary: summary || null,
        errorMessage: error,
      });
      return {
        runId: params.runId,
        status: "failed",
        summary: summary || null,
        error,
        proposalId: null,
        toolCalls,
        turns,
        steps: params.activity.getSteps(),
      };
    }

    actionSequence += 1;
    const protectedResult = await executeProtectedTool({
      admin: params.admin,
      agent: params.agent,
      userId: params.userId,
      runId: params.runId,
      task: params.task,
      toolName,
      toolInput,
      activity: params.activity,
      toolCalls,
      actionSequence,
      turns,
      maxRetries: params.limits.maxRetries,
      workflowNodeIndex: nodeIndex,
      lastToolName,
      lastToolOutput,
      summary,
    });

    if (protectedResult.kind === "awaiting_approval" || protectedResult.kind === "failed") {
      return protectedResult.result;
    }

    if (protectedResult.kind === "blocked") {
      await params.activity.finishRun({
        runId: params.runId,
        status: "failed",
        summary: null,
        errorMessage: protectedResult.reason,
      });
      return {
        runId: params.runId,
        status: "failed",
        summary: null,
        error: protectedResult.reason,
        proposalId: null,
        toolCalls: protectedResult.toolCalls,
        turns,
        steps: params.activity.getSteps(),
      };
    }

    toolCalls = protectedResult.toolCalls;
    lastToolName = toolName;
    lastToolOutput = protectedResult.outcome.output;
    if (toolName === "send_email") {
      deliveredEmail = true;
      emailMessageId =
        typeof lastToolOutput.messageId === "string" ? lastToolOutput.messageId : null;
      emailTo = typeof toolInput.to === "string" ? toolInput.to : null;
    }
    if (toolName === "send_whatsapp_message") {
      deliveredWhatsApp = true;
      whatsappMessageId =
        typeof lastToolOutput.messageId === "string" ? lastToolOutput.messageId : null;
    }

    if (toolName === "query_supabase" || toolName === "query_database") {
      const formatted = formatQueryToolReport({
        toolOutput: lastToolOutput,
        agent: params.agent.record,
        task: params.task,
      });
      summary = formatted.text;
      analysis = formatted.analysis;
    } else if (
      toolName === "web_search" ||
      toolName === "x_search" ||
      toolName === "google_sheets" ||
      toolName === "read_document" ||
      toolName === "fetch_url"
    ) {
      summary = await summarizeToolResultsForTask({
        task: params.task,
        agentName: params.agent.record.name,
        toolName,
        toolOutput: lastToolOutput,
        agentRecord: params.agent.record,
      });
    } else if (typeof lastToolOutput.messageId === "string" && summary) {
      summary = `${summary}\n\nDelivery message ID: ${lastToolOutput.messageId}`;
    }
  }

  if (!summary.trim()) {
    const step = await completeAiWorkflowStep({
      task: params.task,
      agent: params.agent.record,
      lastToolName,
      lastToolOutput,
      existingSummary: summary,
      sourceImage: params.sourceImage,
    });
    summary = step.summary;
    if (step.conceptImages.length) conceptImages = step.conceptImages;
    generationError = step.generationError;
    generationProvider = step.generationProvider;
    generationModel = step.generationModel;
    generationErrorKind = step.generationErrorKind;
    generationRetryable = step.generationRetryable;
  }

  await params.activity.finishRun({
    runId: params.runId,
    status: "completed",
    summary,
    metadata: { deliveredEmail, deliveredWhatsApp, workflow: true, analysis },
  });

  return {
    runId: params.runId,
    status: "completed",
    summary,
    error: null,
    proposalId: null,
    toolCalls,
    turns,
    steps: params.activity.getSteps(),
    analysis,
    conceptImages,
    generationError,
    generationProvider,
    generationModel,
    generationErrorKind,
    generationRetryable,
    delivery:
      deliveredEmail || deliveredWhatsApp
        ? {
            mode: deliveredEmail && deliveredWhatsApp ? "both" : deliveredEmail ? "email" : "whatsapp",
            status: "sent",
            destination: emailTo,
            email: deliveredEmail
              ? {
                  status: "sent" as const,
                  destination: emailTo,
                  providerMessageId: emailMessageId,
                  sentAt: new Date().toISOString(),
                }
              : undefined,
            whatsapp: deliveredWhatsApp
              ? {
                  status: "sent" as const,
                  providerMessageId: whatsappMessageId,
                  sentAt: new Date().toISOString(),
                }
              : undefined,
          }
        : undefined,
  };
}
