import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";
import type { LoadedAgent, ToolHandlerContext } from "../types";
import { analyzeRetrievedRecords } from "./record-validation";
import {
  formatRecordAnalysisReport,
  isMeaningfulAnalysisOutput,
} from "./structured-report";
import { resolveWorkspaceQueryTable } from "../data/resolve-query-source";
import { queryWorkspaceRecords } from "@/lib/agents/tools/handlers/query-supabase";
import { fallbackModelTurn } from "../model/fallback-provider";
import {
  evaluateExecutionCheck,
  evaluateOutputCheck,
} from "@/lib/agents/platform/evaluate-run-checks";
import { resolveTestRunOutcome } from "@/lib/agents/platform/test-run-outcome";

function ticketAgent(overrides?: Partial<BuilderAgentRecord>): BuilderAgentRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    userId: "user-1",
    organizationId: "org-1",
    name: "Support Ticket Evidence Agent",
    slug: "support-ticket-evidence",
    description: "Analyze support tickets and validate incident evidence.",
    goal: "Analyze support-ticket data, validate incident evidence, and generate a detailed report.",
    instructions: "Identify missing or invalid evidence. Do not invent tickets.",
    model: null,
    source: "test",
    tools: ["query_supabase"],
    capabilities: [],
    triggerType: "webhook",
    schedule: {},
    timezone: "UTC",
    memoryEnabled: false,
    safetySettings: {
      setupAnswers: { ticket_source: "helpdesk" },
    },
    suggestedThreshold: 5000,
    status: "testing",
    publishedAt: null,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function loaded(record: BuilderAgentRecord): LoadedAgent {
  return {
    record,
    gatewayAgentId: record.slug,
    systemPrompt: "test",
    enabledTools: record.tools,
  };
}

function context(record: BuilderAgentRecord): ToolHandlerContext {
  return {
    agent: loaded(record),
    runId: null,
    userId: record.userId,
    organizationId: record.organizationId,
  };
}

function mockSupabase(params: {
  crm?: {
    data: Record<string, unknown>[] | null;
    error: { message: string; code?: string } | null;
  };
}): SupabaseClient {
  const crm = params.crm ?? { data: [], error: null };
  const client = {
    from(table: string) {
      const result =
        table === "agent_crm_updates"
          ? crm
          : { data: null, error: { message: `unexpected table ${table}` } };
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle() {
          return Promise.resolve(result);
        },
        then(
          resolve: (value: typeof result) => unknown,
          reject: (reason: unknown) => unknown
        ) {
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return client as unknown as SupabaseClient;
}

const validTicket = {
  ticket_id: "TKT-1001",
  customer_id: "cus_1",
  customer_name: "Ada Lovelace",
  resolution_details: "Server logs attached and incident timeline verified.",
  satisfaction_rating: 4,
};

const invalidTicket = {
  ticket_id: "TKT-1002",
  customer_id: "cus_2",
  customer_name: "Grace Hopper",
  resolution_details: "ok",
  satisfaction_rating: 9,
};

describe("ticket analysis runtime", () => {
  it("routes ticket agents to CRM records instead of the agents table", () => {
    const table = resolveWorkspaceQueryTable({
      requestedTable: "agents",
      agent: ticketAgent(),
      task: "Analyze support tickets and validate evidence.",
    });
    assert.equal(table, "agent_crm_updates");
  });

  it("produces a successful analysis report from retrieved tickets", async () => {
    const agent = ticketAgent();
    const outcome = await queryWorkspaceRecords(
      mockSupabase({ crm: { data: [validTicket], error: null } }),
      { table: "agents", limit: 10 },
      context(agent)
    );
    assert.equal(outcome.executed, true);
    assert.equal(outcome.output.table, "agent_crm_updates");
    assert.equal(outcome.output.rowCount, 1);

    const analysis = analyzeRetrievedRecords({
      table: "agent_crm_updates",
      rows: outcome.output.rows as unknown[],
      agent,
      task: agent.goal ?? "",
    });
    assert.equal(analysis.analysisSucceeded, true);
    assert.equal(analysis.validCount, 1);
    const report = formatRecordAnalysisReport(analysis, agent, agent.goal ?? "");
    assert.match(report, /Tickets retrieved and analyzed: 1/);
    assert.match(report, /TKT-1001/);
    assert.equal(isMeaningfulAnalysisOutput(report, agent.goal ?? ""), true);
  });

  it("reports an empty database without inventing tickets", async () => {
    const agent = ticketAgent();
    const outcome = await queryWorkspaceRecords(
      mockSupabase({ crm: { data: [], error: null } }),
      { table: "tickets", limit: 10 },
      context(agent)
    );
    const analysis = analyzeRetrievedRecords({
      table: String(outcome.output.table),
      rows: outcome.output.rows as unknown[],
      agent,
      task: agent.goal ?? "",
    });
    assert.equal(analysis.empty, true);
    assert.equal(analysis.analysisSucceeded, false);
    const report = formatRecordAnalysisReport(analysis, agent, agent.goal ?? "");
    assert.match(report, /empty/i);
    assert.match(report, /0 records were retrieved/);
    assert.doesNotMatch(report, /TKT-/);
    const output = evaluateOutputCheck({
      agent,
      status: "completed",
      summary: report,
      task: agent.goal ?? "",
      queryOutput: outcome.output,
    });
    assert.equal(output.status, "needs_attention");
  });

  it("treats a missing CRM table as a failed query, not an empty database", async () => {
    const agent = ticketAgent();
    const outcome = await queryWorkspaceRecords(
      mockSupabase({
        crm: {
          data: null,
          error: {
            message:
              "Could not find the table 'public.agent_crm_updates' in the schema cache",
            code: "PGRST205",
          },
        },
      }),
      { table: "agent_crm_updates", limit: 10 },
      context(agent)
    );
    assert.equal(outcome.executed, false);
    assert.equal(outcome.output.tableAvailable, false);
    assert.match(String(outcome.error), /agent_crm_updates is missing/i);
    assert.match(String(outcome.error), /migrate:crm-updates/);
  });

  it("fails honestly when the database query errors", async () => {
    const agent = ticketAgent();
    const outcome = await queryWorkspaceRecords(
      mockSupabase({
        crm: { data: null, error: { message: "connection refused" } },
      }),
      { table: "agent_crm_updates", limit: 10 },
      context(agent)
    );
    assert.equal(outcome.executed, false);
    assert.match(outcome.error ?? "", /connection refused/);
    const analysis = analyzeRetrievedRecords({
      table: "agent_crm_updates",
      rows: [],
      agent,
      task: agent.goal ?? "",
      error: outcome.error,
      tableAvailable: true,
    });
    assert.equal(analysis.analysisSucceeded, false);
    const report = formatRecordAnalysisReport(analysis, agent, agent.goal ?? "");
    assert.match(report, /connection refused/);
    const execution = evaluateExecutionCheck({
      status: "failed",
      error: outcome.error,
      task: agent.goal ?? "",
      toolFailed: true,
    });
    assert.equal(execution.status, "fail");
  });

  it("flags invalid evidence without inventing fields", () => {
    const agent = ticketAgent();
    const analysis = analyzeRetrievedRecords({
      table: "agent_crm_updates",
      rows: [invalidTicket],
      agent,
      task: agent.goal ?? "",
    });
    assert.equal(analysis.invalidEvidenceCount, 1);
    assert.equal(analysis.validCount, 0);
    assert.equal(analysis.findings[0]?.recordId, "TKT-1002");
    assert.ok(analysis.findings[0]?.invalidFields.length);
    const report = formatRecordAnalysisReport(analysis, agent, agent.goal ?? "");
    assert.match(report, /invalid_evidence/);
    assert.match(report, /TKT-1002/);
  });

  it("marks tool execution failure as a failed execution check", () => {
    const execution = evaluateExecutionCheck({
      status: "failed",
      error: "query_supabase is not enabled for this agent.",
      task: "Analyze support tickets.",
      toolFailed: true,
    });
    assert.equal(execution.status, "fail");
    assert.match(execution.message ?? "", /query_supabase|failed/i);
  });

  it("does not treat prompt echo as successful output", () => {
    const agent = ticketAgent();
    const task = agent.goal ?? "";
    const output = evaluateOutputCheck({
      agent,
      status: "completed",
      summary: `${task}\n\nUse this saved configuration:\n- ticket source: helpdesk`,
      task,
    });
    assert.equal(output.status, "fail");
  });

  it("skips malformed records instead of inventing tickets", () => {
    const agent = ticketAgent();
    const analysis = analyzeRetrievedRecords({
      table: "agent_crm_updates",
      rows: ["not-an-object", { ticket_id: "TKT-1003" }],
      agent,
      task: agent.goal ?? "",
    });
    assert.equal(analysis.skippedCount, 1);
    assert.equal(analysis.findings[0]?.validationStatus, "skipped");
    assert.equal(analysis.findings[1]?.validationStatus, "missing_evidence");
    assert.doesNotMatch(formatRecordAnalysisReport(analysis, agent, agent.goal ?? ""), /TKT-9999/);
  });

  it("does not mark empty or failed analysis as a successful test run", () => {
    const empty = resolveTestRunOutcome({
      runStatus: "completed",
      runError: null,
      checks: [
        { id: "execution", label: "Execution", status: "pass" },
        { id: "output", label: "Output", status: "needs_attention", message: "empty" },
      ],
      analysis: {
        table: "agent_crm_updates",
        sourceLabel: "agent_crm_updates",
        retrievedCount: 0,
        analyzedCount: 0,
        validCount: 0,
        missingEvidenceCount: 0,
        invalidEvidenceCount: 0,
        skippedCount: 0,
        findings: [],
        errors: [],
        skippedReasons: [],
        nextSteps: [],
        empty: true,
        unavailable: false,
        analysisSucceeded: false,
      },
    });
    assert.equal(empty.success, false);
    assert.equal(empty.kind, "empty");

    const failed = resolveTestRunOutcome({
      runStatus: "completed",
      runError: null,
      checks: [
        { id: "execution", label: "Execution", status: "pass" },
        { id: "output", label: "Output", status: "fail" },
      ],
      analysis: {
        table: "agent_crm_updates",
        sourceLabel: "agent_crm_updates",
        retrievedCount: 0,
        analyzedCount: 0,
        validCount: 0,
        missingEvidenceCount: 0,
        invalidEvidenceCount: 0,
        skippedCount: 0,
        findings: [],
        errors: ["connection refused"],
        skippedReasons: [],
        nextSteps: [],
        empty: false,
        unavailable: true,
        analysisSucceeded: false,
      },
    });
    assert.equal(failed.success, false);
    assert.equal(failed.kind, "failed");
  });

  it("asks the fallback provider to query CRM tickets, not the agents table", async () => {
    const turn = await fallbackModelTurn({
      agent: loaded(ticketAgent()),
      task: "Analyze support-ticket data and validate incident evidence.",
      messages: [],
      enabledToolNames: ["query_supabase"],
    });
    assert.equal(turn.type, "tool_call");
    if (turn.type === "tool_call") {
      assert.equal(turn.toolName, "query_supabase");
      assert.equal(turn.toolInput.table, "agent_crm_updates");
    }
  });
});
