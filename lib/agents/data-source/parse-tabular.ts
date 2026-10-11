import { MAX_SAMPLE_ROWS, MAX_SOURCE_ROWS } from "./types";

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

export function parseCsvText(raw: string, maxRows = MAX_SOURCE_ROWS): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const lines = raw
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = splitCsvLine(lines[0]).map((header, index) => header || `column_${index + 1}`);
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1, maxRows + 1)) {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    rows.push(row);
  }
  return { headers, rows };
}

export function parseJsonRecords(raw: string, maxRows = MAX_SOURCE_ROWS): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("JSON sample must be an array of objects.");
  }
  const rows: Record<string, string>[] = [];
  const headerSet = new Set<string>();
  for (const item of parsed.slice(0, maxRows)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row: Record<string, string> = {};
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      headerSet.add(key);
      row[key] = value == null ? "" : String(value);
    }
    rows.push(row);
  }
  return { headers: [...headerSet], rows };
}

export function parseTabularInput(raw: string, options?: { sample?: boolean }): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const trimmed = raw.trim();
  if (!trimmed) return { headers: [], rows: [] };
  const maxRows = options?.sample ? MAX_SAMPLE_ROWS : MAX_SOURCE_ROWS;
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const normalized = trimmed.startsWith("{") ? `[${trimmed}]` : trimmed;
    return parseJsonRecords(normalized, maxRows);
  }
  return parseCsvText(trimmed, maxRows);
}

export function sheetValuesToRecords(values: string[][]): {
  headers: string[];
  rows: Record<string, string>[];
} {
  if (!values.length) return { headers: [], rows: [] };
  const headers = values[0].map((header, index) => String(header || `column_${index + 1}`).trim());
  const rows = values.slice(1, MAX_SOURCE_ROWS + 1).map((line) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = line[index] != null ? String(line[index]) : "";
    });
    return row;
  });
  return { headers, rows };
}
