export type SuggestionSource = "stated_preferences" | "web_search";

export interface PlaceHint {
  name: string;
  url?: string;
  snippet?: string;
}

export interface TasteSnapshot {
  source: SuggestionSource;
  queriedAt: string;
  error?: string;
  usedSignals: string[];
  places: PlaceHint[];
}

export function emptyTaste(signals: string[] = []): TasteSnapshot {
  return {
    source: "stated_preferences",
    queriedAt: new Date().toISOString(),
    usedSignals: signals.filter((item) => item.trim()),
    places: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Reads the JSON stored in the existing `qloo` database column.
 * Legacy Qloo payloads are treated as historical, unverified names only.
 * WAVE never calls Qloo.
 */
export function mapStoredTaste(value: unknown): TasteSnapshot {
  const rec = asRecord(value);
  if (!rec) return emptyTaste();

  const usedSignals = Array.isArray(rec.usedSignals)
    ? rec.usedSignals.filter((item): item is string => typeof item === "string")
    : [];
  const queriedAt = readString(rec.queriedAt) ?? new Date().toISOString();
  const error = readString(rec.error) ?? undefined;

  if (rec.source === "web_search" || rec.source === "stated_preferences") {
    const places: PlaceHint[] = [];
    const rawPlaces = Array.isArray(rec.places) ? rec.places : [];
    for (const item of rawPlaces) {
      const row = asRecord(item);
      const name = row ? readString(row.name) : null;
      if (!name) continue;
      places.push({
        name,
        url: row ? readString(row.url) ?? undefined : undefined,
        snippet: row ? readString(row.snippet) ?? undefined : undefined,
      });
    }
    return {
      source: rec.source,
      queriedAt,
      error,
      usedSignals,
      places,
    };
  }

  const places: PlaceHint[] = [];
  const entities = Array.isArray(rec.entities) ? rec.entities : [];
  for (const item of entities) {
    const row = asRecord(item);
    const name = row ? readString(row.name) : null;
    if (name) places.push({ name });
  }
  return {
    source: "stated_preferences",
    queriedAt,
    error,
    usedSignals,
    places,
  };
}
