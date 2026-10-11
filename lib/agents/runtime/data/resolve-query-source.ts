import { setupAnswersFromAgent } from "../execution-plan";
import type { LoadedAgent } from "../types";
import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";

export const WORKSPACE_QUERY_TABLES = [
  "agents",
  "uploaded_logs",
  "action_proposals",
  "agent_crm_updates",
] as const;

export type WorkspaceQueryTable = (typeof WORKSPACE_QUERY_TABLES)[number];

const TABLE_ALIASES: Record<string, WorkspaceQueryTable> = {
  agents: "agents",
  uploaded_logs: "uploaded_logs",
  logs: "uploaded_logs",
  action_proposals: "action_proposals",
  proposals: "action_proposals",
  agent_crm_updates: "agent_crm_updates",
  tickets: "agent_crm_updates",
  ticket: "agent_crm_updates",
  support_tickets: "agent_crm_updates",
  crm: "agent_crm_updates",
  crm_updates: "agent_crm_updates",
};

const TICKET_TASK_PATTERN =
  /\b(tickets?|incidents?|evidence|help\s*desk|helpdesk|support ticket|crm)\b/i;

export function agentTextBlob(
  agent: Pick<BuilderAgentRecord, "goal" | "description" | "instructions" | "name" | "safetySettings">,
  task?: string
): string {
  const answers = setupAnswersFromAgent(agent);
  return [
    task ?? "",
    agent.name,
    agent.goal ?? "",
    agent.description ?? "",
    agent.instructions ?? "",
    Object.entries(answers)
      .map(([key, value]) => `${key} ${value}`)
      .join(" "),
  ].join(" ");
}

export function isTicketAnalysisContext(
  agent: Pick<BuilderAgentRecord, "goal" | "description" | "instructions" | "name" | "safetySettings">,
  task?: string
): boolean {
  const answers = setupAnswersFromAgent(agent);
  if (answers.ticket_source?.trim()) return true;
  return TICKET_TASK_PATTERN.test(agentTextBlob(agent, task));
}

export function normalizeWorkspaceTable(value: string | undefined | null): WorkspaceQueryTable | null {
  if (!value?.trim()) return null;
  return TABLE_ALIASES[value.trim().toLowerCase()] ?? null;
}

export function resolveWorkspaceQueryTable(params: {
  requestedTable?: string | null;
  agent: Pick<BuilderAgentRecord, "goal" | "description" | "instructions" | "name" | "safetySettings">;
  task?: string;
}): WorkspaceQueryTable {
  const requested = normalizeWorkspaceTable(params.requestedTable);
  if (isTicketAnalysisContext(params.agent, params.task)) {
    if (!requested || requested === "agents") {
      return "agent_crm_updates";
    }
    return requested;
  }
  if (requested) return requested;

  const blob = agentTextBlob(params.agent, params.task);
  if (/\b(upload|log|document|file)\b/i.test(blob)) return "uploaded_logs";
  if (/\bproposal\b/i.test(blob)) return "action_proposals";
  return "agents";
}

export function resolveDatabaseQueryInput(params: {
  agent: LoadedAgent;
  task: string;
  requestedTable?: string | null;
  limit?: number;
}): Record<string, unknown> {
  const table = resolveWorkspaceQueryTable({
    requestedTable: params.requestedTable,
    agent: params.agent.record,
    task: params.task,
  });
  const limit =
    typeof params.limit === "number" && params.limit > 0 && params.limit <= 25
      ? Math.floor(params.limit)
      : 25;

  const input: Record<string, unknown> = { table, limit };
  if (table === "agents") {
    input.slug = params.agent.record.slug;
  }
  return input;
}

export function taskNeedsRecordLookup(task: string, agent: LoadedAgent): boolean {
  if (
    !agent.enabledTools.includes("query_supabase") &&
    !agent.enabledTools.includes("query_database")
  ) {
    return false;
  }
  if (isTicketAnalysisContext(agent.record, task)) return true;
  const blob = agentTextBlob(agent.record, task);
  return /\b(databas(e|es)|quer(y|ies)|records?|lookup|analy[sz]e|validate|report)\b/i.test(
    blob
  );
}

export function hasQueryDatabaseTool(tools: string[]): boolean {
  return tools.includes("query_supabase") || tools.includes("query_database");
}
