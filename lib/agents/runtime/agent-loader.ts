import type { SupabaseClient } from "@supabase/supabase-js";
import { isAgentDbStatusPaused } from "../agent-mode";
import { resolveAgentToolsForAgent } from "../builder-capabilities";
import { getBuilderAgentById } from "../repository";
import type { BuilderAgentRecord } from "../runtime-types";
import { normalizeEnabledTools } from "../tools/registry";
import { AgentNotRunnableError } from "./errors";
import { buildRuntimePlanPrompt, planFromBuilderAgent } from "./execution-plan";
import type { LoadedAgent } from "./types";

function buildSystemPrompt(agent: BuilderAgentRecord, enabledTools: string[]): string {
  const goal = agent.goal?.trim() || agent.description.trim();
  const instructions = agent.instructions?.trim();
  const tools = enabledTools.length > 0 ? enabledTools.join(", ") : "none";
  const plan = planFromBuilderAgent(agent);

  const parts = [
    `You are ${agent.name}, a Wave agent.`,
    `Goal: ${goal}`,
  ];

  if (instructions) {
    parts.push(`Instructions: ${instructions}`);
  }

  const planPrompt = buildRuntimePlanPrompt({
    workflowPlan: plan.workflowPlan,
    setupAnswers: plan.setupAnswers,
  });
  if (planPrompt.trim()) {
    parts.push(planPrompt);
  }

  parts.push(
    `Enabled tools (you may ONLY use these): ${tools}.`,
    "Respond with valid JSON only using one of these shapes:",
    '{"type":"complete","message":"final deliverable for the user","reasoning":"optional"}',
    '{"type":"tool_call","toolName":"tool_id","toolInput":{},"actionType":"optional","reasoning":"why"}',
    "Execution rules:",
    "- ALWAYS use tools to gather real data before completing research, news, link summaries, email, lookup, ticket, or database tasks.",
    "- If a source URL is provided or fetch_url is enabled, call fetch_url first. Never summarize a YouTube video, article, or page you did not fetch.",
    "- NEVER repeat the user's prompt, saved configuration, or say Completed: ... as your final answer.",
    "- NEVER invent tickets, evidence, IDs, or findings. If the database is empty or disconnected, say so.",
    "- Your final message must be the actual result (summary, report, list, draft, etc.).",
    "- Format the final message as Markdown: headings, bullet lists, numbered lists, and GitHub-style tables (header row, separator row of ---, then data rows).",
    "- Put Sources at the end as a Markdown list of real URLs only. Never invent sources, statistics, or links.",
    "- If research tools did not return current information, say that clearly instead of guessing.",
    "- Use tool_call when you need fresh information or to perform an action.",
    "- Never invent tools. Never bypass Wave Protection.",
    "- Use saved configuration values (email, WhatsApp, company, schedule) instead of inventing destinations.",
    "- For read_document, pass {\"documentId\":\"latest\"} unless the user named a specific upload. Do not invent upload IDs."
  );

  return parts.join("\n");
}

export async function loadAgentForRuntime(
  supabase: SupabaseClient,
  params: {
    agentDbId: string;
    userId: string;
    runMode?: "manual" | "test" | "scheduled" | "live";
  }
): Promise<LoadedAgent> {
  const record = await getBuilderAgentById(supabase, {
    agentId: params.agentDbId,
    userId: params.userId,
  });

  if (!record) {
    throw new AgentNotRunnableError("Agent not found.");
  }

  if (isAgentDbStatusPaused(record.status)) {
    throw new AgentNotRunnableError(
      "This agent is paused. Resume it before running scheduled tasks."
    );
  }

  const isTestRun = params.runMode === "test";
  const isManualRun = params.runMode === "manual" || params.runMode === undefined;
  const runnableStatuses = new Set(["published", "active", "testing", "draft"]);

  if (
    params.runMode === "scheduled" &&
    !["published", "active", "testing"].includes(record.status)
  ) {
    throw new AgentNotRunnableError("Activate your agent before scheduled runs can execute.");
  }

  if (!runnableStatuses.has(record.status) && !isTestRun && !isManualRun) {
    throw new AgentNotRunnableError(
      isTestRun
        ? "Save your agent first, then try testing again."
        : "This agent cannot run in the current state."
    );
  }

  const mergedTools = resolveAgentToolsForAgent({
    tools: record.tools,
    capabilities: record.capabilities,
    goal: record.goal,
    description: record.description,
    instructions: record.instructions,
  });

  const enabledTools = normalizeEnabledTools(mergedTools);

  return {
    record,
    gatewayAgentId: record.slug,
    systemPrompt: buildSystemPrompt({ ...record, tools: enabledTools }, enabledTools),
    enabledTools,
  };
}
