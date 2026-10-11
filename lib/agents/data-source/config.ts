import type { AgentSafetySettings, BuilderAgentRecord } from "@/lib/agents/runtime-types";
import type { AgentDataSourceConfig, AgentDataSourceKind, AgentFieldMapping } from "./types";
import { AGENT_DATA_SOURCE_KINDS } from "./types";

export const GOOGLE_SHEETS_UNAVAILABLE_MESSAGE =
  "Google Sheets is no longer supported. Choose CSV upload or sample / test rows, then save and verify.";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function readDataSourceConfig(
  agent: Pick<BuilderAgentRecord, "safetySettings">
): AgentDataSourceConfig | null {
  const raw = asRecord(agent.safetySettings.dataSource);
  if (!raw) return null;
  const kind = typeof raw.kind === "string" ? raw.kind : "";
  if (!AGENT_DATA_SOURCE_KINDS.includes(kind as AgentDataSourceKind)) return null;

  const mapping = Array.isArray(raw.mapping)
    ? raw.mapping
        .map((item) => {
          const record = asRecord(item);
          if (!record) return null;
          const sourceColumn =
            typeof record.sourceColumn === "string" ? record.sourceColumn.trim() : "";
          const targetField =
            typeof record.targetField === "string" ? record.targetField.trim() : "";
          if (!targetField) return null;
          return { sourceColumn, targetField } satisfies AgentFieldMapping;
        })
        .filter((item): item is AgentFieldMapping => Boolean(item))
    : [];

  const csv = asRecord(raw.csv);
  const sheets = asRecord(raw.sheets);
  const manual = asRecord(raw.manual);
  const headers = Array.isArray(raw.headers)
    ? raw.headers.filter((item): item is string => typeof item === "string")
    : [];

  return {
    kind: kind as AgentDataSourceKind,
    verifiedAt: typeof raw.verifiedAt === "string" ? raw.verifiedAt : null,
    lastError: typeof raw.lastError === "string" ? raw.lastError : null,
    isSample: Boolean(raw.isSample) || kind === "manual_sample",
    mapping,
    headers,
    rowCount: typeof raw.rowCount === "number" ? raw.rowCount : null,
    csv:
      csv && typeof csv.filename === "string"
        ? {
            uploadId: typeof csv.uploadId === "string" ? csv.uploadId : "",
            filename: csv.filename,
            storagePath: typeof csv.storagePath === "string" ? csv.storagePath : "",
            inlineText: typeof csv.inlineText === "string" ? csv.inlineText : undefined,
          }
        : undefined,
    sheets:
      sheets && typeof sheets.spreadsheetId === "string"
        ? {
            spreadsheetId: sheets.spreadsheetId.trim(),
            range:
              typeof sheets.range === "string" && sheets.range.trim()
                ? sheets.range.trim()
                : "Sheet1!A1:Z200",
            sheetTitle: typeof sheets.sheetTitle === "string" ? sheets.sheetTitle : undefined,
            gid: typeof sheets.gid === "string" ? sheets.gid : undefined,
            access: sheets.access === "oauth" ? "oauth" : "public",
            spreadsheetTitle:
              typeof sheets.spreadsheetTitle === "string" ? sheets.spreadsheetTitle : undefined,
            lastRefreshedAt:
              typeof sheets.lastRefreshedAt === "string" ? sheets.lastRefreshedAt : undefined,
          }
        : undefined,
    manual:
      manual && typeof manual.raw === "string"
        ? { raw: manual.raw }
        : undefined,
  };
}

export function writeDataSourceConfig(
  safetySettings: AgentSafetySettings,
  config: AgentDataSourceConfig | null
): AgentSafetySettings {
  return {
    ...safetySettings,
    dataSource: config ?? undefined,
  };
}

export function isDataSourceVerified(config: AgentDataSourceConfig | null): boolean {
  if (!config?.verifiedAt) return false;
  if (config.kind === "wave_database") return true;
  if (config.kind === "manual_sample") return (config.rowCount ?? 0) > 0;
  if (config.kind === "csv_upload") {
    return Boolean(config.csv?.storagePath || config.csv?.inlineText);
  }
  if (config.kind === "google_sheets") return false;
  return false;
}

export function sourceKindLabel(kind: AgentDataSourceKind, isSample: boolean): string {
  if (isSample || kind === "manual_sample") return "Sample / test data";
  switch (kind) {
    case "csv_upload":
      return "CSV upload";
    case "google_sheets":
      return "Google Sheet (no longer supported)";
    case "wave_database":
      return "Wave ticket table (agent_crm_updates)";
    default:
      return kind;
  }
}
