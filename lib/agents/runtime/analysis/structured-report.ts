import { isTicketAnalysisContext } from "../data/resolve-query-source";
import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";
import {
  analyzeRetrievedRecords,
  type RecordAnalysisResult,
} from "./record-validation";
import { isPromptEcho } from "../model/task-intent";

export function formatRecordAnalysisReport(
  analysis: RecordAnalysisResult,
  agent: Pick<BuilderAgentRecord, "name" | "goal" | "description" | "instructions" | "safetySettings">,
  task?: string
): string {
  const ticketMode = isTicketAnalysisContext(agent, task);
  const title = ticketMode
    ? `${agent.name}: support ticket evidence report`
    : `${agent.name}: data query report`;

  const lines: string[] = [`# ${title}`, ""];

  if (analysis.unavailable) {
    lines.push("## Status");
    lines.push(
      "The configured database is unavailable or disconnected. No records were analyzed."
    );
    lines.push("");
    lines.push(`Source: ${analysis.sourceLabel}`);
    if (analysis.errors.length) {
      lines.push("");
      lines.push("## Errors");
      for (const error of analysis.errors) lines.push(`- ${error}`);
    }
    lines.push("");
    lines.push("## Recommended next steps");
    for (const step of analysis.nextSteps) lines.push(`- ${step}`);
    lines.push("");
    lines.push("Analysis did not succeed.");
    return lines.join("\n").trim();
  }

  if (analysis.empty) {
    lines.push("## Status");
    lines.push(
      `The ${ticketMode ? "ticket source" : "database"} is empty. 0 records were retrieved and 0 records were analyzed.`
    );
    lines.push("");
    lines.push(`Source: ${analysis.sourceLabel}`);
    lines.push("Tickets retrieved and analyzed: 0");
    lines.push("Valid tickets: 0");
    lines.push("Tickets with missing evidence: 0");
    lines.push("Tickets with invalid evidence: 0");
    lines.push("");
    lines.push("## Recommended next steps");
    for (const step of analysis.nextSteps) lines.push(`- ${step}`);
    lines.push("");
    lines.push("No real analysis succeeded because no records were available.");
    return lines.join("\n").trim();
  }

  lines.push("## Summary");
  if (ticketMode) {
    lines.push(`- Tickets retrieved and analyzed: ${analysis.analyzedCount}`);
    lines.push(`- Valid tickets: ${analysis.validCount}`);
    lines.push(`- Tickets with missing evidence: ${analysis.missingEvidenceCount}`);
    lines.push(`- Tickets with invalid evidence: ${analysis.invalidEvidenceCount}`);
  } else {
    lines.push(`- Records retrieved: ${analysis.retrievedCount}`);
    lines.push(`- Records analyzed: ${analysis.analyzedCount}`);
    lines.push(`- Valid records: ${analysis.validCount}`);
    lines.push(`- Records with missing fields: ${analysis.missingEvidenceCount}`);
    lines.push(`- Records with invalid fields: ${analysis.invalidEvidenceCount}`);
  }
  lines.push(`- Skipped records: ${analysis.skippedCount}`);
  lines.push(`- Source: ${analysis.sourceLabel}`);
  lines.push("");

  lines.push("## Findings");
  lines.push("| Record ID | Status | Missing | Invalid | Explanation |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const finding of analysis.findings) {
    lines.push(
      `| ${escapeCell(finding.recordId)} | ${finding.validationStatus} | ${escapeCell(finding.missingFields.join(", ") || "—")} | ${escapeCell(finding.invalidFields.join(", ") || "—")} | ${escapeCell(finding.explanation)} |`
    );
  }

  if (analysis.errors.length) {
    lines.push("");
    lines.push("## Errors");
    for (const error of analysis.errors) lines.push(`- ${error}`);
  }

  if (analysis.skippedReasons.length) {
    lines.push("");
    lines.push("## Skipped records");
    for (const reason of analysis.skippedReasons) lines.push(`- ${reason}`);
  }

  if (analysis.nextSteps.length) {
    lines.push("");
    lines.push("## Recommended next steps");
    for (const step of analysis.nextSteps) lines.push(`- ${step}`);
  }

  return lines.join("\n").trim();
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function analysisFromQueryToolOutput(params: {
  toolOutput: Record<string, unknown>;
  agent: Pick<BuilderAgentRecord, "name" | "goal" | "description" | "instructions" | "safetySettings">;
  task?: string;
  toolError?: string | null;
}): RecordAnalysisResult {
  const table = typeof params.toolOutput.table === "string" ? params.toolOutput.table : "unknown";
  const sourceLabel =
    typeof params.toolOutput.source === "string" ? params.toolOutput.source : table;
  const rows = Array.isArray(params.toolOutput.rows) ? params.toolOutput.rows : [];
  const tableAvailable =
    params.toolOutput.tableAvailable === undefined
      ? true
      : Boolean(params.toolOutput.tableAvailable);

  return analyzeRetrievedRecords({
    table,
    rows,
    agent: params.agent,
    task: params.task,
    error:
      params.toolError ||
      (typeof params.toolOutput.error === "string" ? params.toolOutput.error : null),
    tableAvailable,
    sourceLabel,
  });
}

export function formatQueryToolReport(params: {
  toolOutput: Record<string, unknown>;
  agent: Pick<BuilderAgentRecord, "name" | "goal" | "description" | "instructions" | "safetySettings">;
  task?: string;
  toolError?: string | null;
}): { text: string; analysis: RecordAnalysisResult } {
  const analysis = analysisFromQueryToolOutput(params);
  return {
    analysis,
    text: formatRecordAnalysisReport(analysis, params.agent, params.task),
  };
}

export function isMeaningfulAnalysisOutput(message: string, task: string): boolean {
  const text = message.trim();
  if (!text) return false;
  if (isPromptEcho(text, task)) return false;
  if (/use this saved configuration/i.test(text) && text.includes(task.slice(0, 40))) {
    return false;
  }
  if (/no real analysis succeeded|0 records were retrieved|database is unavailable|database is empty/i.test(text)) {
    return false;
  }
  return (
    /tickets retrieved and analyzed|records retrieved|records analyzed|validation status|valid tickets/i.test(
      text
    ) || text.length > 80
  );
}
