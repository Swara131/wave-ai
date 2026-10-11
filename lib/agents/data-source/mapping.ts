import type { EvidenceFieldSpec } from "@/lib/agents/runtime/analysis/record-validation";
import type { AgentFieldMapping } from "./types";

const GENERIC_TOKENS = new Set(["id", "name", "details", "value", "data", "field", "col", "column"]);

const FIELD_ALIASES: Record<string, string[]> = {
  ticket_id: ["ticket_id", "ticketid", "ticket", "case_id", "caseid", "incident_id", "issue_id"],
  customer_id: ["customer_id", "customerid", "account_id", "user_id", "client_id", "cust_id"],
  customer_name: [
    "customer_name",
    "customer",
    "client_name",
    "account_name",
    "full_name",
    "contact_name",
  ],
  resolution_details: [
    "resolution_details",
    "resolution",
    "evidence",
    "incident_evidence",
    "notes",
    "description",
    "details",
  ],
  satisfaction_rating: ["satisfaction_rating", "rating", "csat", "score", "satisfaction"],
};

export function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function aliasesFor(field: EvidenceFieldSpec): string[] {
  const extra = FIELD_ALIASES[field.key] ?? [];
  return [...new Set([normalizeHeader(field.key), normalizeHeader(field.label), ...extra])].filter(
    (item) => item.length > 0
  );
}

function tokens(value: string): string[] {
  return normalizeHeader(value)
    .split("_")
    .filter((token) => token.length > 1 && !GENERIC_TOKENS.has(token));
}

function scoreHeader(header: string, field: EvidenceFieldSpec): number {
  const normalized = normalizeHeader(header);
  if (!normalized) return 0;
  const aliasSet = new Set(aliasesFor(field));
  if (normalized === normalizeHeader(field.key) || normalized === normalizeHeader(field.label)) {
    return 100;
  }
  if (aliasSet.has(normalized)) return 92;
  if ([...aliasSet].some((alias) => alias.length >= 6 && normalized === alias)) return 90;

  const fieldTokens = tokens(field.key).length > 0 ? tokens(field.key) : tokens(field.label);
  const headerTokens = tokens(header);
  if (fieldTokens.length > 0 && headerTokens.length > 0) {
    const overlap = fieldTokens.filter((token) => headerTokens.includes(token));
    if (overlap.length === fieldTokens.length && overlap.length === headerTokens.length && overlap.length >= 2) {
      return 80;
    }
    if (overlap.length === fieldTokens.length && fieldTokens.length >= 2) return 72;
  }

  if (normalized.length >= 6 && aliasSet.has(normalized)) return 70;
  return 0;
}

export function suggestFieldMapping(
  headers: string[],
  fields: EvidenceFieldSpec[]
): AgentFieldMapping[] {
  const uniqueHeaders = [...new Set(headers.filter((header) => header.trim().length > 0))];
  const candidates: Array<{ fieldKey: string; header: string; score: number }> = [];
  for (const field of fields) {
    for (const header of uniqueHeaders) {
      const score = scoreHeader(header, field);
      if (score >= 72) candidates.push({ fieldKey: field.key, header, score });
    }
  }
  candidates.sort((left, right) => right.score - left.score || left.fieldKey.localeCompare(right.fieldKey));

  const usedFields = new Set<string>();
  const usedHeaders = new Set<string>();
  const assigned = new Map<string, string>();
  for (const candidate of candidates) {
    if (usedFields.has(candidate.fieldKey) || usedHeaders.has(candidate.header)) continue;
    usedFields.add(candidate.fieldKey);
    usedHeaders.add(candidate.header);
    assigned.set(candidate.fieldKey, candidate.header);
  }

  return fields.map((field) => ({
    targetField: field.key,
    sourceColumn: assigned.get(field.key) ?? "",
  }));
}

export function reconcileFieldMapping(
  stored: AgentFieldMapping[],
  suggested: AgentFieldMapping[],
  headers: string[]
): AgentFieldMapping[] {
  const headerSet = new Set(headers);
  const storedByTarget = new Map(
    stored.map((item) => [item.targetField, item.sourceColumn?.trim() ?? ""])
  );
  const used = new Set<string>();
  return suggested.map((item) => {
    const suggestedColumn = item.sourceColumn.trim();
    const storedColumn = storedByTarget.get(item.targetField)?.trim() ?? "";
    let chosen = suggestedColumn;
    if (!chosen && storedColumn && headerSet.has(storedColumn) && !used.has(storedColumn)) {
      chosen = storedColumn;
    }
    if (chosen && used.has(chosen)) chosen = "";
    if (chosen) used.add(chosen);
    return { targetField: item.targetField, sourceColumn: chosen };
  });
}

export function validateFieldMapping(
  mapping: AgentFieldMapping[],
  fields: EvidenceFieldSpec[],
  headers: string[]
): string[] {
  const errors: string[] = [];
  const headerSet = new Set(headers.map((header) => header.trim()));
  const used = new Map<string, string>();
  for (const field of fields.filter((item) => item.required)) {
    const mapped = mapping.find((item) => item.targetField === field.key)?.sourceColumn?.trim();
    if (!mapped) {
      errors.push(`Map a source column to ${field.label}.`);
      continue;
    }
    if (!headerSet.has(mapped)) {
      errors.push(`Column "${mapped}" is not in the source headers.`);
      continue;
    }
    const previous = used.get(mapped);
    if (previous) {
      errors.push(`Column "${mapped}" is mapped to more than one field.`);
    } else {
      used.set(mapped, field.key);
    }
  }
  return errors;
}

export function applyFieldMapping(
  rows: Record<string, unknown>[],
  mapping: AgentFieldMapping[]
): Record<string, unknown>[] {
  return rows.map((row) => {
    const next: Record<string, unknown> = {};
    for (const item of mapping) {
      if (!item.targetField || !item.sourceColumn) continue;
      next[item.targetField] = row[item.sourceColumn];
    }
    return next;
  });
}

export function mappingToRecord(mapping: AgentFieldMapping[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const item of mapping) next[item.targetField] = item.sourceColumn;
  return next;
}
