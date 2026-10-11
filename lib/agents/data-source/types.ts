import type { EvidenceFieldSpec } from "@/lib/agents/runtime/analysis/record-validation";

export const AGENT_DATA_SOURCE_KINDS = [
  "wave_database",
  "csv_upload",
  "google_sheets",
  "manual_sample",
] as const;

export type AgentDataSourceKind = (typeof AGENT_DATA_SOURCE_KINDS)[number];

export interface AgentFieldMapping {
  sourceColumn: string;
  targetField: string;
}

export interface AgentDataSourceConfig {
  kind: AgentDataSourceKind;
  verifiedAt: string | null;
  lastError: string | null;
  isSample: boolean;
  mapping: AgentFieldMapping[];
  headers: string[];
  rowCount: number | null;
    csv?: {
    uploadId: string;
    filename: string;
    storagePath: string;
    /** Bounded copy of the file so analysis can run if object storage is unavailable. */
    inlineText?: string;
  };
  sheets?: {
    spreadsheetId: string;
    range: string;
    sheetTitle?: string;
    gid?: string;
    access: "public" | "oauth";
    spreadsheetTitle?: string;
    lastRefreshedAt?: string;
  };
  manual?: {
    raw: string;
  };
}

export interface LoadedAgentSource {
  kind: AgentDataSourceKind | "none";
  isSample: boolean;
  sourceLabel: string;
  headers: string[];
  rows: Record<string, unknown>[];
  retrievedCount: number;
  empty: boolean;
  unavailable: boolean;
  error: string | null;
  tableAvailable: boolean;
}

export interface DataSourceCapabilities {
  waveDatabaseConfigured: boolean;
}

export interface DataSourcePublicView {
  config: AgentDataSourceConfig | null;
  capabilities: DataSourceCapabilities;
  evidenceFields: EvidenceFieldSpec[];
  requiredTargets: string[];
}

export const MAX_SOURCE_ROWS = 200;
export const MAX_SAMPLE_ROWS = 25;
export const MAX_CSV_BYTES = 2_000_000;
