import { handleWebSearch } from "@/lib/agents/tools/handlers/web-search";
import { emptyTaste, type PlaceHint, type TasteSnapshot } from "./snapshot";

function uniquePlaces(places: PlaceHint[]): PlaceHint[] {
  const seen = new Set<string>();
  const out: PlaceHint[] = [];
  for (const place of places) {
    const key = place.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(place);
  }
  return out;
}

export async function fetchWebPlaceHints(params: {
  query: string;
  signals: string[];
}): Promise<TasteSnapshot> {
  const signals = params.signals.map((item) => item.trim()).filter(Boolean);
  const query = params.query.trim();
  if (!query) return emptyTaste(signals);

  const outcome = await handleWebSearch({ query, count: 8 });
  if (!outcome.executed) {
    return {
      ...emptyTaste(signals),
      error:
        typeof outcome.error === "string"
          ? outcome.error
          : "Web search is not configured. WAVE used stated preferences only.",
    };
  }

  const raw = outcome.output.results;
  const places: PlaceHint[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const row = item as { title?: unknown; url?: unknown; description?: unknown };
      const name = typeof row.title === "string" ? row.title.trim() : "";
      if (!name) continue;
      places.push({
        name,
        url: typeof row.url === "string" && row.url.trim() ? row.url.trim() : undefined,
        snippet:
          typeof row.description === "string" && row.description.trim()
            ? row.description.trim()
            : undefined,
      });
    }
  }

  const unique = uniquePlaces(places).slice(0, 12);
  return {
    source: unique.length ? "web_search" : "stated_preferences",
    queriedAt: new Date().toISOString(),
    error: unique.length
      ? undefined
      : "Web search returned no place titles. WAVE used stated preferences only.",
    usedSignals: signals,
    places: unique,
  };
}
