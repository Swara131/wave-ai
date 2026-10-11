import { createAdminClient } from "@/lib/supabase/admin";
import { logDatabaseQueryDiagnostic, sanitizeDatabaseError } from "@/lib/agents/crm/db-errors";
import { loadAgentSourceRecords } from "@/lib/agents/data-source/load-records";
import { readDataSourceConfig } from "@/lib/agents/data-source/config";
import { isTicketAnalysisContext } from "@/lib/agents/runtime/data/resolve-query-source";
import {
  resolveWorkspaceQueryTable,
  type WorkspaceQueryTable,
} from "@/lib/agents/runtime/data/resolve-query-source";
import type { ToolExecutionOutcome, ToolHandlerContext } from "../../runtime/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const AGENT_PUBLIC_COLUMNS = [
  "id",
  "name",
  "slug",
  "status",
  "updated_at",
  "created_at",
] as const;

function sanitizeRows(table: WorkspaceQueryTable, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  if (table !== "agents") return rows;
  return rows.map((row) => {
    const sanitized: Record<string, unknown> = {};
    for (const column of AGENT_PUBLIC_COLUMNS) {
      if (column in row) sanitized[column] = row[column];
    }
    return sanitized;
  });
}

export async function queryWorkspaceRecords(
  supabase: SupabaseClient,
  input: Record<string, unknown>,
  context: ToolHandlerContext
): Promise<ToolExecutionOutcome> {
  const requested =
    (typeof input.table === "string" && input.table.trim()) ||
    (typeof input.resource === "string" && input.resource.trim()) ||
    null;
  const table = resolveWorkspaceQueryTable({
    requestedTable: requested,
    agent: context.agent.record,
    task: typeof input.task === "string" ? input.task : context.agent.record.goal ?? "",
  });

  const limit =
    typeof input.limit === "number" && input.limit > 0 && input.limit <= 25
      ? Math.floor(input.limit)
      : 10;

  try {
    const dataSource = readDataSourceConfig(context.agent.record);
    if (dataSource || isTicketAnalysisContext(context.agent.record) || table === "agent_crm_updates") {
      const loaded = await loadAgentSourceRecords({
        supabase,
        agent: context.agent.record,
        userId: context.userId,
        organizationId: context.organizationId,
        limit,
      });
      if (loaded.unavailable || (loaded.error && !loaded.tableAvailable)) {
        return {
          executed: false,
          error: loaded.error ?? "The selected data source is unavailable.",
          output: {
            table,
            source: loaded.sourceLabel,
            tableAvailable: loaded.tableAvailable,
            isSample: loaded.isSample,
            rowCount: 0,
            rows: [],
          },
        };
      }
      return {
        executed: true,
        output: {
          table,
          source: loaded.sourceLabel,
          tableAvailable: true,
          isSample: loaded.isSample,
          rowCount: loaded.retrievedCount,
          rows: loaded.rows,
          error: loaded.empty ? loaded.error : null,
        },
      };
    }

    let query = supabase.from(table).select("*").eq("user_id", context.userId).limit(limit);

    if (table === "agents" && typeof input.slug === "string" && input.slug.trim()) {
      query = query.eq("slug", input.slug.trim());
    }

    if (table === "uploaded_logs" && typeof input.status === "string" && input.status.trim()) {
      query = query.eq("status", input.status.trim());
    }

    const { data, error } = await query;

    if (error) {
      logDatabaseQueryDiagnostic({
        table,
        code: error.code,
        message: error.message,
      });
      return {
        executed: false,
        error: sanitizeDatabaseError(error.message),
        output: { table, tableAvailable: true, rowCount: 0, rows: [] },
      };
    }

    const rows = sanitizeRows(table, (data ?? []) as Record<string, unknown>[]);
    return {
      executed: true,
      output: {
        table,
        source: table,
        tableAvailable: true,
        rowCount: rows.length,
        rows,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database query failed.";
    logDatabaseQueryDiagnostic({ table, message });
    return {
      executed: false,
      error: sanitizeDatabaseError(message),
      output: { table, tableAvailable: false, rowCount: 0, rows: [] },
    };
  }
}

export async function handleQuerySupabase(
  input: Record<string, unknown>,
  context: ToolHandlerContext
): Promise<ToolExecutionOutcome> {
  return queryWorkspaceRecords(createAdminClient(), input, context);
}
