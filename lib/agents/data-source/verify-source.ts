import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveEvidenceFields } from "@/lib/agents/runtime/analysis/record-validation";
import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";
import { reconcileFieldMapping, suggestFieldMapping, validateFieldMapping } from "./mapping";
import {
  GOOGLE_SHEETS_UNAVAILABLE_MESSAGE,
  isDataSourceVerified,
  readDataSourceConfig,
} from "./config";
import { loadAgentSourceRecords } from "./load-records";
import type { AgentDataSourceConfig, DataSourceCapabilities } from "./types";

export { isDataSourceVerified };

export function dataSourceCapabilities(): DataSourceCapabilities {
  return {
    waveDatabaseConfigured: true,
  };
}

export async function verifyAgentDataSource(params: {
  supabase: SupabaseClient;
  agent: BuilderAgentRecord;
  userId: string;
  organizationId: string;
}): Promise<{ config: AgentDataSourceConfig; error: string | null }> {
  const current = readDataSourceConfig(params.agent);
  if (!current) {
    throw new Error("Select a data source first.");
  }
  if (current.kind === "google_sheets") {
    return {
      config: {
        ...current,
        verifiedAt: null,
        lastError: GOOGLE_SHEETS_UNAVAILABLE_MESSAGE,
      },
      error: GOOGLE_SHEETS_UNAVAILABLE_MESSAGE,
    };
  }

  const fields = resolveEvidenceFields(params.agent);
  const loaded = await loadAgentSourceRecords({
    supabase: params.supabase,
    agent: params.agent,
    userId: params.userId,
    organizationId: params.organizationId,
    limit: 25,
    skipMapping: true,
  });

  const mapping = reconcileFieldMapping(
    current.mapping,
    suggestFieldMapping(loaded.headers, fields),
    loaded.headers
  );
  const mappingErrors =
    current.kind === "wave_database" ? [] : validateFieldMapping(mapping, fields, loaded.headers);

  if (loaded.unavailable || loaded.error) {
    return {
      config: {
        ...current,
        mapping,
        headers: loaded.headers,
        rowCount: loaded.retrievedCount,
        verifiedAt: null,
        lastError: loaded.error,
      },
      error: loaded.error,
    };
  }

  if (mappingErrors.length > 0) {
    const message = mappingErrors.join(" ");
    return {
      config: {
        ...current,
        mapping,
        headers: loaded.headers,
        rowCount: loaded.retrievedCount,
        verifiedAt: null,
        lastError: message,
      },
      error: message,
    };
  }

  return {
    config: {
      ...current,
      mapping,
      headers: loaded.headers,
      rowCount: loaded.retrievedCount,
      verifiedAt: new Date().toISOString(),
      lastError: loaded.empty ? "Source is reachable but returned 0 records." : null,
    },
    error: null,
  };
}
