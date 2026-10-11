import { setupAnswersFromAgent } from "../execution-plan";
import { isTicketAnalysisContext } from "../data/resolve-query-source";
import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";

export type RecordValidationStatus = "valid" | "missing_evidence" | "invalid_evidence" | "skipped";

export interface EvidenceFieldSpec {
  key: string;
  label: string;
  required: boolean;
  kind: "string" | "integer_1_5";
  minLength?: number;
}

export interface RecordFinding {
  recordId: string;
  validationStatus: RecordValidationStatus;
  missingFields: string[];
  invalidFields: string[];
  explanation: string;
}

export interface RecordAnalysisResult {
  table: string;
  sourceLabel: string;
  retrievedCount: number;
  analyzedCount: number;
  validCount: number;
  missingEvidenceCount: number;
  invalidEvidenceCount: number;
  skippedCount: number;
  findings: RecordFinding[];
  errors: string[];
  skippedReasons: string[];
  nextSteps: string[];
  empty: boolean;
  unavailable: boolean;
  analysisSucceeded: boolean;
}

const DEFAULT_TICKET_FIELDS: EvidenceFieldSpec[] = [
  { key: "ticket_id", label: "ticket ID", required: true, kind: "string" },
  { key: "customer_id", label: "customer ID", required: true, kind: "string" },
  { key: "customer_name", label: "customer name", required: true, kind: "string" },
  {
    key: "resolution_details",
    label: "incident evidence / resolution details",
    required: true,
    kind: "string",
    minLength: 5,
  },
  {
    key: "satisfaction_rating",
    label: "satisfaction rating",
    required: true,
    kind: "integer_1_5",
  },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function readField(row: Record<string, unknown>, key: string): unknown {
  if (key in row) return row[key];
  const camel = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  if (camel in row) return row[camel];
  return undefined;
}

function parseConfiguredFields(raw: string): EvidenceFieldSpec[] {
  return raw
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((key) => ({
      key: key.replace(/\s+/g, "_").toLowerCase(),
      label: key.replace(/_/g, " "),
      required: true,
      kind: "string" as const,
    }));
}

export function resolveEvidenceFields(
  agent: Pick<BuilderAgentRecord, "goal" | "description" | "instructions" | "name" | "safetySettings">,
  task?: string
): EvidenceFieldSpec[] {
  const answers = setupAnswersFromAgent(agent);
  const configured =
    answers.evidence_fields ||
    answers.required_evidence ||
    answers.evidence_requirements ||
    answers.required_fields;
  if (configured) {
    const parsed = parseConfiguredFields(configured);
    if (parsed.length > 0) return parsed;
  }
  if (isTicketAnalysisContext(agent, task)) {
    return DEFAULT_TICKET_FIELDS;
  }
  return [];
}

export function recordIdFromRow(row: Record<string, unknown>, index: number): string {
  const candidates = [row.ticket_id, row.ticketId, row.id, row.slug];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number") return String(candidate);
  }
  return `row-${index + 1}`;
}

function validateField(
  spec: EvidenceFieldSpec,
  value: unknown
): "ok" | "missing" | "invalid" {
  if (value === undefined || value === null || value === "") {
    return spec.required ? "missing" : "ok";
  }
  if (spec.kind === "integer_1_5") {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 5) return "invalid";
    return "ok";
  }
  const text = String(value).trim();
  if (!text) return spec.required ? "missing" : "ok";
  if (spec.minLength && text.length < spec.minLength) return "invalid";
  return "ok";
}

export function validateRecordAgainstEvidence(
  row: Record<string, unknown>,
  fields: EvidenceFieldSpec[],
  index: number
): RecordFinding {
  const recordId = recordIdFromRow(row, index);
  if (fields.length === 0) {
    return {
      recordId,
      validationStatus: "valid",
      missingFields: [],
      invalidFields: [],
      explanation: "Record retrieved. No evidence field requirements were configured.",
    };
  }

  const missingFields: string[] = [];
  const invalidFields: string[] = [];
  for (const field of fields) {
    const result = validateField(field, readField(row, field.key));
    if (result === "missing") missingFields.push(field.label);
    if (result === "invalid") invalidFields.push(field.label);
  }

  if (missingFields.length > 0 && invalidFields.length > 0) {
    return {
      recordId,
      validationStatus: "invalid_evidence",
      missingFields,
      invalidFields,
      explanation: `Missing ${missingFields.join(", ")}; invalid ${invalidFields.join(", ")}.`,
    };
  }
  if (invalidFields.length > 0) {
    return {
      recordId,
      validationStatus: "invalid_evidence",
      missingFields,
      invalidFields,
      explanation: `Invalid evidence: ${invalidFields.join(", ")}.`,
    };
  }
  if (missingFields.length > 0) {
    return {
      recordId,
      validationStatus: "missing_evidence",
      missingFields,
      invalidFields,
      explanation: `Missing evidence: ${missingFields.join(", ")}.`,
    };
  }
  return {
    recordId,
    validationStatus: "valid",
    missingFields: [],
    invalidFields: [],
    explanation: "All configured evidence fields are present and valid.",
  };
}

export function analyzeRetrievedRecords(params: {
  table: string;
  rows: unknown[];
  agent: Pick<BuilderAgentRecord, "goal" | "description" | "instructions" | "name" | "safetySettings">;
  task?: string;
  error?: string | null;
  tableAvailable?: boolean;
  sourceLabel?: string;
}): RecordAnalysisResult {
  const fields = resolveEvidenceFields(params.agent, params.task);
  const errors: string[] = [];
  const skippedReasons: string[] = [];
  const findings: RecordFinding[] = [];
  const unavailable = params.tableAvailable === false || Boolean(params.error);
  if (params.error) errors.push(params.error);

  if (unavailable && params.rows.length === 0) {
    return {
      table: params.table,
      sourceLabel: params.sourceLabel ?? params.table,
      retrievedCount: 0,
      analyzedCount: 0,
      validCount: 0,
      missingEvidenceCount: 0,
      invalidEvidenceCount: 0,
      skippedCount: 0,
      findings: [],
      errors: errors.length ? errors : ["The configured database is unavailable or disconnected."],
      skippedReasons,
      nextSteps: [
        "Reconnect or migrate the ticket/CRM table (agent_crm_updates).",
        "Run the CRM migration if the table is missing.",
        "Do not treat this run as a successful analysis.",
      ],
      empty: false,
      unavailable: true,
      analysisSucceeded: false,
    };
  }

  let skippedCount = 0;
  params.rows.forEach((raw, index) => {
    const row = asRecord(raw);
    if (!row) {
      skippedCount += 1;
      skippedReasons.push(`Row ${index + 1} was skipped because it was not an object.`);
      findings.push({
        recordId: `row-${index + 1}`,
        validationStatus: "skipped",
        missingFields: [],
        invalidFields: [],
        explanation: "Skipped: record was not a structured object.",
      });
      return;
    }
    findings.push(validateRecordAgainstEvidence(row, fields, index));
  });

  const analyzed = findings.filter((item) => item.validationStatus !== "skipped");
  const empty = params.rows.length === 0;
  const nextSteps: string[] = [];
  if (empty) {
    nextSteps.push("Add or import real ticket records into the configured source, then run again.");
    nextSteps.push("Confirm the selected ticket source is connected and writing into Wave.");
  } else {
    if (findings.some((item) => item.validationStatus === "missing_evidence")) {
      nextSteps.push("Collect the missing evidence fields on the listed tickets.");
    }
    if (findings.some((item) => item.validationStatus === "invalid_evidence")) {
      nextSteps.push("Correct invalid evidence values (for example ratings must be integers 1–5).");
    }
    if (skippedCount > 0) {
      nextSteps.push("Inspect skipped rows; they were not structured records.");
    }
  }

  return {
    table: params.table,
    sourceLabel: params.sourceLabel ?? params.table,
    retrievedCount: params.rows.length,
    analyzedCount: analyzed.length,
    validCount: findings.filter((item) => item.validationStatus === "valid").length,
    missingEvidenceCount: findings.filter((item) => item.validationStatus === "missing_evidence")
      .length,
    invalidEvidenceCount: findings.filter((item) => item.validationStatus === "invalid_evidence")
      .length,
    skippedCount,
    findings,
    errors,
    skippedReasons,
    nextSteps,
    empty,
    unavailable: false,
    analysisSucceeded: !empty && analyzed.length > 0,
  };
}
