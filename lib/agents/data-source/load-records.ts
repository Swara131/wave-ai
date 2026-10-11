import type { SupabaseClient } from "@supabase/supabase-js";
import { LOG_UPLOADS_BUCKET } from "@/lib/storage/constants";
import { listCrmRecords } from "@/lib/agents/crm/repository";
import { resolveEvidenceFields } from "@/lib/agents/runtime/analysis/record-validation";
import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";
import { applyFieldMapping, validateFieldMapping } from "./mapping";
import { parseTabularInput } from "./parse-tabular";
import {
  GOOGLE_SHEETS_UNAVAILABLE_MESSAGE,
  readDataSourceConfig,
  sourceKindLabel,
} from "./config";
import type { LoadedAgentSource } from "./types";
import { MAX_CSV_BYTES } from "./types";

function emptySource(partial: Partial<LoadedAgentSource>): LoadedAgentSource {
  return {
    kind: "none",
    isSample: false,
    sourceLabel: "No data source",
    headers: [],
    rows: [],
    retrievedCount: 0,
    empty: false,
    unavailable: true,
    error: "No data source configured.",
    tableAvailable: false,
    ...partial,
  };
}

async function loadCsvRows(
  supabase: SupabaseClient,
  userId: string,
  storagePath: string
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  if (!storagePath.startsWith(`${userId}/`)) {
    throw new Error("You do not have access to this CSV path.");
  }
  const { data, error } = await supabase.storage.from(LOG_UPLOADS_BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(error?.message ?? "Could not download the uploaded CSV.");
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  if (buffer.byteLength > MAX_CSV_BYTES) {
    throw new Error("CSV is larger than the 2 MB agent-data limit.");
  }
  return parseTabularInput(buffer.toString("utf8"));
}

export async function loadAgentSourceRecords(params: {
  supabase: SupabaseClient;
  agent: BuilderAgentRecord;
  userId: string;
  organizationId: string;
  limit?: number;
  skipMapping?: boolean;
}): Promise<LoadedAgentSource> {
  const config = readDataSourceConfig(params.agent);
  const fields = resolveEvidenceFields(params.agent);
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);

  if (!config) {
    const listed = await listCrmRecords(params.supabase, {
      organizationId: params.organizationId,
      userId: params.userId,
      agentId: params.agent.id,
      limit,
    });
    if (listed.error || !listed.tableAvailable) {
      return emptySource({
        kind: "wave_database",
        sourceLabel: "Wave ticket table (agent_crm_updates)",
        error:
          (listed.error ?? "Wave ticket table is unavailable.") +
          " Connect a CSV or sample rows in Prepare your agent so you can run without inserting database records.",
        tableAvailable: listed.tableAvailable,
      });
    }
    const rows = listed.rows.slice(0, limit);
    return {
      kind: "wave_database",
      isSample: false,
      sourceLabel: "Wave ticket table (agent_crm_updates)",
      headers: rows[0] ? Object.keys(rows[0] as Record<string, unknown>) : [],
      rows,
      retrievedCount: rows.length,
      empty: rows.length === 0,
      unavailable: false,
      error: null,
      tableAvailable: true,
    };
  }

  const label = sourceKindLabel(config.kind, config.isSample);
  try {
    let headers = config.headers;
    let rawRows: Record<string, unknown>[] = [];

    if (config.kind === "manual_sample") {
      const parsed = parseTabularInput(config.manual?.raw ?? "", { sample: true });
      headers = parsed.headers;
      rawRows = parsed.rows;
    } else if (config.kind === "csv_upload") {
      if (!config.csv?.storagePath && !config.csv?.inlineText) {
        return emptySource({
          kind: config.kind,
          isSample: false,
          sourceLabel: label,
          error: "Upload a CSV file and verify it before running this agent.",
        });
      }
      let parsed: { headers: string[]; rows: Record<string, string>[] };
      if (config.csv.storagePath) {
        try {
          parsed = await loadCsvRows(params.supabase, params.userId, config.csv.storagePath);
        } catch (err) {
          if (!config.csv.inlineText) throw err;
          parsed = parseTabularInput(config.csv.inlineText);
        }
      } else {
        parsed = parseTabularInput(config.csv.inlineText ?? "");
      }
      headers = parsed.headers;
      rawRows = parsed.rows;
    } else if (config.kind === "google_sheets") {
      return emptySource({
        kind: config.kind,
        sourceLabel: label,
        error: GOOGLE_SHEETS_UNAVAILABLE_MESSAGE,
      });
    } else {
      const listed = await listCrmRecords(params.supabase, {
        organizationId: params.organizationId,
        userId: params.userId,
        agentId: params.agent.id,
        limit,
      });
      if (listed.error || !listed.tableAvailable) {
        return emptySource({
          kind: config.kind,
          sourceLabel: label,
          error: listed.error,
          tableAvailable: listed.tableAvailable,
        });
      }
      rawRows = listed.rows;
      headers =
        listed.rows[0] && typeof listed.rows[0] === "object"
          ? Object.keys(listed.rows[0] as Record<string, unknown>)
          : [];
      const sliced = rawRows.slice(0, limit);
      return {
        kind: config.kind,
        isSample: false,
        sourceLabel: label,
        headers,
        rows: sliced,
        retrievedCount: sliced.length,
        empty: sliced.length === 0,
        unavailable: false,
        error: null,
        tableAvailable: true,
      };
    }

    if (!params.skipMapping) {
      const mappingErrors = validateFieldMapping(config.mapping, fields, headers);
      if (mappingErrors.length > 0) {
        return emptySource({
          kind: config.kind,
          isSample: config.isSample,
          sourceLabel: label,
          headers,
          error: mappingErrors.join(" "),
        });
      }
    }

    const mapped = (
      params.skipMapping ? rawRows : applyFieldMapping(rawRows, config.mapping)
    ).slice(0, limit);
    return {
      kind: config.kind,
      isSample: config.isSample,
      sourceLabel: label,
      headers,
      rows: mapped,
      retrievedCount: mapped.length,
      empty: mapped.length === 0,
      unavailable: false,
      error: null,
      tableAvailable: true,
    };
  } catch (err) {
    return emptySource({
      kind: config.kind,
      isSample: config.isSample,
      sourceLabel: label,
      error: err instanceof Error ? err.message : "Could not read the selected data source.",
    });
  }
}
