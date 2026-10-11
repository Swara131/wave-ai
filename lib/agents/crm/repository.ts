import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupportTicketInput } from "./types";
import {
  CRM_TABLE_MISSING_MESSAGE,
  isMissingCrmTableError,
  logDatabaseQueryDiagnostic,
  sanitizeDatabaseError,
} from "./db-errors";

export { isMissingCrmTableError, CRM_TABLE_MISSING_MESSAGE } from "./db-errors";

export interface CrmUpdateRow {
  id: string;
  agentId: string;
  organizationId: string;
  ticketId: string;
  customerId: string;
  customerName: string | null;
  resolutionDetails: string;
  satisfactionRating: number | null;
  createdAt: string;
}

const CRM_LOG_KEY = "crmUpdates";
const CRM_LOG_MAX = 50;

function mapRow(row: Record<string, unknown>): CrmUpdateRow {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    organizationId: row.organization_id as string,
    ticketId: row.ticket_id as string,
    customerId: row.customer_id as string,
    customerName: (row.customer_name as string) ?? null,
    resolutionDetails: row.resolution_details as string,
    satisfactionRating: (row.satisfaction_rating as number) ?? null,
    createdAt: row.created_at as string,
  };
}


function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

async function insertCrmUpdateFallback(
  supabase: SupabaseClient,
  params: {
    agentId: string;
    organizationId: string;
    userId: string;
    agentRunId?: string | null;
    ticket: SupportTicketInput;
  }
): Promise<CrmUpdateRow> {
  const { data: agent, error: readError } = await supabase
    .from("agents")
    .select("safety_settings")
    .eq("id", params.agentId)
    .single();

  if (readError || !agent) {
    throw new Error(readError?.message ?? "Failed to save CRM update on agent record.");
  }

  const safetySettings = asRecord(agent.safety_settings);
  const existing = Array.isArray(safetySettings[CRM_LOG_KEY])
    ? (safetySettings[CRM_LOG_KEY] as Record<string, unknown>[])
    : [];

  const row: CrmUpdateRow = {
    id: randomUUID(),
    agentId: params.agentId,
    organizationId: params.organizationId,
    ticketId: params.ticket.ticketId,
    customerId: params.ticket.customerId,
    customerName: params.ticket.customerName,
    resolutionDetails: params.ticket.resolutionDetails,
    satisfactionRating: params.ticket.satisfactionRating,
    createdAt: new Date().toISOString(),
  };

  const nextLog = [
    {
      id: row.id,
      agent_id: row.agentId,
      organization_id: row.organizationId,
      user_id: params.userId,
      agent_run_id: params.agentRunId ?? null,
      ticket_id: row.ticketId,
      customer_id: row.customerId,
      customer_name: row.customerName,
      resolution_details: row.resolutionDetails,
      satisfaction_rating: row.satisfactionRating,
      status: "updated",
      created_at: row.createdAt,
      stored_in: "agent_safety_settings",
    },
    ...existing,
  ].slice(0, CRM_LOG_MAX);

  const { error: writeError } = await supabase
    .from("agents")
    .update({
      safety_settings: {
        ...safetySettings,
        [CRM_LOG_KEY]: nextLog,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.agentId);

  if (writeError) {
    throw new Error(writeError.message);
  }

  return row;
}

export async function insertCrmUpdate(
  supabase: SupabaseClient,
  params: {
    agentId: string;
    organizationId: string;
    userId: string;
    agentRunId?: string | null;
    ticket: SupportTicketInput;
  }
): Promise<CrmUpdateRow> {
  const { data, error } = await supabase
    .from("agent_crm_updates")
    .insert({
      agent_id: params.agentId,
      organization_id: params.organizationId,
      user_id: params.userId,
      agent_run_id: params.agentRunId ?? null,
      ticket_id: params.ticket.ticketId,
      customer_id: params.ticket.customerId,
      customer_name: params.ticket.customerName,
      resolution_details: params.ticket.resolutionDetails,
      satisfaction_rating: params.ticket.satisfactionRating,
      status: "updated",
    })
    .select("*")
    .single();

  if (!error && data) {
    return mapRow(data as Record<string, unknown>);
  }

  const message = error?.message ?? "Failed to save CRM update.";
  if (isMissingCrmTableError(message)) {
    return insertCrmUpdateFallback(supabase, params);
  }

  throw new Error(message);
}

export async function listCrmRecords(
  supabase: SupabaseClient,
  params: {
    organizationId: string;
    userId: string;
    agentId: string;
    limit: number;
  }
): Promise<{
  rows: Record<string, unknown>[];
  source: "agent_crm_updates" | "agent_safety_settings";
  tableAvailable: boolean;
  error: string | null;
}> {
  const { data, error } = await supabase
    .from("agent_crm_updates")
    .select("*")
    .eq("organization_id", params.organizationId)
    .eq("user_id", params.userId)
    .limit(params.limit);

  if (!error) {
    return {
      rows: (data ?? []) as Record<string, unknown>[],
      source: "agent_crm_updates",
      tableAvailable: true,
      error: null,
    };
  }

  const message = sanitizeDatabaseError(error.message);
  logDatabaseQueryDiagnostic({
    table: "agent_crm_updates",
    code: error.code,
    message: error.message,
  });

  if (isMissingCrmTableError(error.message)) {
    return {
      rows: [],
      source: "agent_crm_updates",
      tableAvailable: false,
      error: CRM_TABLE_MISSING_MESSAGE,
    };
  }

  return {
    rows: [],
    source: "agent_crm_updates",
    tableAvailable: true,
    error: message,
  };
}

export async function countCrmCustomers(
  supabase: SupabaseClient,
  params: { organizationId: string; customerId: string; agentId: string }
): Promise<number> {
  const { count, error } = await supabase
    .from("agent_crm_updates")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", params.organizationId)
    .eq("customer_id", params.customerId);

  if (!error && typeof count === "number") {
    return count;
  }

  const { data: agent } = await supabase
    .from("agents")
    .select("safety_settings")
    .eq("id", params.agentId)
    .maybeSingle();
  const safetySettings = asRecord(agent?.safety_settings);
  const existing = Array.isArray(safetySettings[CRM_LOG_KEY])
    ? (safetySettings[CRM_LOG_KEY] as Record<string, unknown>[])
    : [];
  return existing.filter((row) => row.customer_id === params.customerId).length;
}

export async function deleteCrmCustomer(
  supabase: SupabaseClient,
  params: {
    agentId: string;
    organizationId: string;
    customerId: string;
  }
): Promise<{ deletedCount: number }> {
  const { data, error } = await supabase
    .from("agent_crm_updates")
    .delete()
    .eq("organization_id", params.organizationId)
    .eq("customer_id", params.customerId)
    .select("id");

  if (!error) {
    return { deletedCount: data?.length ?? 0 };
  }

  const message = error.message;
  if (!isMissingCrmTableError(message)) {
    throw new Error(message);
  }

  const { data: agent, error: readError } = await supabase
    .from("agents")
    .select("safety_settings")
    .eq("id", params.agentId)
    .single();

  if (readError || !agent) {
    throw new Error(readError?.message ?? "Failed to load CRM records.");
  }

  const safetySettings = asRecord(agent.safety_settings);
  const existing = Array.isArray(safetySettings[CRM_LOG_KEY])
    ? (safetySettings[CRM_LOG_KEY] as Record<string, unknown>[])
    : [];
  const remaining = existing.filter((row) => row.customer_id !== params.customerId);
  const deletedCount = existing.length - remaining.length;

  const { error: writeError } = await supabase
    .from("agents")
    .update({
      safety_settings: {
        ...safetySettings,
        [CRM_LOG_KEY]: remaining,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.agentId);

  if (writeError) {
    throw new Error(writeError.message);
  }

  return { deletedCount };
}
