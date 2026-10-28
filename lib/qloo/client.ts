import {
  getQlooApiBaseUrl,
  getQlooApiKey,
  QLOO_HACKATHON_API_BASE_URL,
  shouldRetryQlooOnHackathon,
  unauthorizedQlooMessage,
} from "./env";
import type { QlooEntity, QlooErrorKind, QlooTag, QlooTasteResult } from "./types";

const REQUEST_TIMEOUT_MS = 12_000;

export class QlooClientError extends Error {
  readonly kind: QlooErrorKind;
  readonly status?: number;

  constructor(kind: QlooErrorKind, message: string, status?: number) {
    super(message);
    this.name = "QlooClientError";
    this.kind = kind;
    this.status = status;
  }
}

function classifyHttpStatus(status: number): QlooErrorKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  return "unavailable";
}

async function qlooGet(
  pathAndQuery: string,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<{ ok: true; json: unknown; endpoint: string } | { ok: false; error: QlooClientError }> {
  const apiKey = getQlooApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error: new QlooClientError(
        "missing_key",
        "QLOO_API_KEY is not set. WAVE will use the traveler's or customer's stated preferences."
      ),
    };
  }

  const primaryBase = getQlooApiBaseUrl();
  const primary = await qlooGetAgainst(primaryBase, pathAndQuery, apiKey, timeoutMs);
  if (primary.ok) return primary;
  if (
    (primary.error.status === 401 || primary.error.status === 403) &&
    shouldRetryQlooOnHackathon(primaryBase)
  ) {
    const retry = await qlooGetAgainst(QLOO_HACKATHON_API_BASE_URL, pathAndQuery, apiKey, timeoutMs);
    if (retry.ok) return retry;
    return retry;
  }
  return primary;
}

async function qlooGetAgainst(
  baseUrl: string,
  pathAndQuery: string,
  apiKey: string,
  timeoutMs: number
): Promise<{ ok: true; json: unknown; endpoint: string } | { ok: false; error: QlooClientError }> {
  const endpoint = `${baseUrl}${pathAndQuery}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Api-Key": apiKey,
      },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const kind = classifyHttpStatus(response.status);
      const message =
        kind === "unauthorized"
          ? unauthorizedQlooMessage(response.status)
          : `Qloo returned HTTP ${response.status}.`;
      return {
        ok: false,
        error: new QlooClientError(kind, message, response.status),
      };
    }

    const json: unknown = await response.json();
    return { ok: true, json, endpoint };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        ok: false,
        error: new QlooClientError("timeout", "Qloo request timed out."),
      };
    }
    return {
      ok: false,
      error: new QlooClientError(
        "unavailable",
        err instanceof Error ? err.message : "Qloo request failed."
      ),
    };
  } finally {
    clearTimeout(timer);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseTags(payload: unknown): QlooTag[] {
  const root = asRecord(payload);
  const results = asRecord(root?.results);
  const list = Array.isArray(results?.tags)
    ? results.tags
    : Array.isArray(root?.tags)
      ? root.tags
      : [];
  const tags: QlooTag[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const tagId =
      readString(row.tag_id) ?? readString(row.id) ?? readString(row.tag_value);
    const name = readString(row.name);
    if (!tagId || !name) continue;
    tags.push({
      tagId,
      name,
      subtype: readString(row.subtype) ?? undefined,
    });
  }
  return tags;
}

function parseEntities(payload: unknown): QlooEntity[] {
  const root = asRecord(payload);
  const results = asRecord(root?.results);
  const list = Array.isArray(results?.entities)
    ? results.entities
    : Array.isArray(root?.entities)
      ? root.entities
      : [];
  const entities: QlooEntity[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const entityId = readString(row.entity_id) ?? readString(row.id);
    const name = readString(row.name);
    if (!entityId || !name) continue;
    const popularity =
      typeof row.popularity === "number" && Number.isFinite(row.popularity)
        ? row.popularity
        : undefined;
    const properties = asRecord(row.properties);
    const location = asRecord(row.location) ?? asRecord(properties?.location);
    const query = asRecord(row.query);
    const affinityRaw = query?.affinity ?? row.affinity ?? row.score;
    const affinity =
      typeof affinityRaw === "number" && Number.isFinite(affinityRaw) ? affinityRaw : undefined;
    const tagNames: string[] = [];
    const rawTags = Array.isArray(row.tags) ? row.tags : Array.isArray(properties?.tags) ? properties.tags : [];
    for (const tag of rawTags) {
      const tagRow = asRecord(tag);
      const tagName = tagRow ? readString(tagRow.name) : readString(tag);
      if (tagName) tagNames.push(tagName);
    }
    entities.push({
      entityId,
      name,
      subtype: readString(row.subtype) ?? undefined,
      popularity,
      address:
        readString(properties?.address) ??
        readString(row.address) ??
        readString(location?.address) ??
        undefined,
      neighborhood:
        readString(location?.neighborhood) ??
        readString(location?.locality) ??
        readString(properties?.neighborhood) ??
        undefined,
      affinity,
      tags: tagNames.length ? tagNames : undefined,
    });
  }
  return entities;
}

function fallbackResult(
  error: QlooClientError,
  usedSignals: string[]
): QlooTasteResult {
  return {
    source: "fallback",
    queriedAt: new Date().toISOString(),
    endpoint: "",
    tags: [],
    entities: [],
    errorKind: error.kind,
    error: error.message,
    usedSignals,
  };
}

/**
 * Official Tags Search: GET /v2/tags with a query string.
 * Tries `query` then `filter.query` as documented parameter spellings.
 */
export async function searchQlooTags(query: string): Promise<QlooTag[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const encoded = encodeURIComponent(trimmed);
  const first = await qlooGet(`/v2/tags?query=${encoded}`);
  if (first.ok) return parseTags(first.json);

  if (
    first.error.kind === "missing_key" ||
    first.error.kind === "unauthorized" ||
    first.error.kind === "rate_limited" ||
    first.error.kind === "timeout"
  ) {
    throw first.error;
  }

  const second = await qlooGet(`/v2/tags?filter.query=${encoded}`);
  if (second.ok) return parseTags(second.json);
  if (second.error.kind === "missing_key" || second.error.kind === "unauthorized") {
    throw second.error;
  }
  return [];
}

/**
 * Taste analysis via GET /v2/insights with filter.type=urn:tag
 * as documented in Qloo Taste Analysis.
 */
export async function fetchQlooTasteInsights(params: {
  tagIds: string[];
  take?: number;
}): Promise<{ tags: QlooTag[]; entities: QlooEntity[]; endpoint: string }> {
  if (params.tagIds.length === 0) {
    return { tags: [], entities: [], endpoint: "" };
  }

  const search = new URLSearchParams();
  search.set("filter.type", "urn:tag");
  search.set("signal.interests.tags", params.tagIds.join(","));
  search.set("take", String(params.take ?? 12));

  const taste = await qlooGet(`/v2/insights?${search.toString()}`);
  if (!taste.ok) throw taste.error;

  const brandSearch = new URLSearchParams();
  brandSearch.set("filter.type", "urn:entity:brand");
  brandSearch.set("signal.interests.tags", params.tagIds.join(","));
  brandSearch.set("take", String(params.take ?? 8));
  const brands = await qlooGet(`/v2/insights?${brandSearch.toString()}`);

  return {
    tags: parseTags(taste.json),
    entities: brands.ok ? parseEntities(brands.json) : [],
    endpoint: taste.endpoint,
  };
}

export async function fetchLightingTaste(params: {
  style: string;
  extraQueries: string[];
}): Promise<QlooTasteResult> {
  const usedSignals = [params.style, ...params.extraQueries]
    .map((item) => item.trim())
    .filter(Boolean);

  try {
    const queries = usedSignals.slice(0, 4);
    const found: QlooTag[] = [];
    const batches = await Promise.all(
      queries.map(async (query) => {
        try {
          return await searchQlooTags(query);
        } catch (err) {
          if (
            err instanceof QlooClientError &&
            (err.kind === "missing_key" || err.kind === "unauthorized" || err.kind === "rate_limited")
          ) {
            throw err;
          }
          return [] as QlooTag[];
        }
      })
    );
    for (const tags of batches) {
      for (const tag of tags) {
        if (!found.some((item) => item.tagId === tag.tagId)) found.push(tag);
      }
    }

    const signalIds = found.slice(0, 5).map((tag) => tag.tagId);
    if (signalIds.length === 0) {
      return {
        source: "fallback",
        queriedAt: new Date().toISOString(),
        endpoint: `${getQlooApiBaseUrl()}/v2/tags`,
        tags: [],
        entities: [],
        errorKind: "empty",
        error: "Qloo returned no tags for the selected décor style.",
        usedSignals,
      };
    }

    const insights = await fetchQlooTasteInsights({ tagIds: signalIds });
    const hasData = insights.tags.length > 0 || insights.entities.length > 0;
    return {
      source: hasData ? "qloo" : "fallback",
      queriedAt: new Date().toISOString(),
      endpoint: insights.endpoint,
      tags: insights.tags.slice(0, 12),
      entities: insights.entities.slice(0, 8),
      errorKind: hasData ? undefined : "empty",
      error: hasData ? undefined : "Qloo returned no taste or brand insights for those tags.",
      usedSignals,
    };
  } catch (err) {
    if (err instanceof QlooClientError) {
      return fallbackResult(err, usedSignals);
    }
    return fallbackResult(
      new QlooClientError(
        "unavailable",
        err instanceof Error ? err.message : "Qloo request failed."
      ),
      usedSignals
    );
  }
}

/**
 * Named-entity resolution: GET /search, then GET /v2/search if needed.
 * Does not invent entity IDs.
 */
export async function searchQlooEntities(query: string): Promise<QlooEntity[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const encoded = encodeURIComponent(trimmed);
  const first = await qlooGet(`/search?query=${encoded}`);
  if (first.ok) return parseEntities(first.json);
  if (first.error.kind === "missing_key" || first.error.kind === "unauthorized" || first.error.kind === "rate_limited") {
    throw first.error;
  }
  const second = await qlooGet(`/v2/search?query=${encoded}`);
  if (second.ok) return parseEntities(second.json);
  if (second.error.kind === "missing_key" || second.error.kind === "unauthorized") {
    throw second.error;
  }
  return [];
}

/**
 * Place insights for a city using tags and/or resolved entities.
 * Official Insights filter: filter.type=urn:entity:place and filter.location.query.
 */
export async function fetchQlooPlaceInsights(params: {
  city: string;
  tagIds: string[];
  entityIds: string[];
  take?: number;
}): Promise<{ entities: QlooEntity[]; endpoint: string }> {
  const search = new URLSearchParams();
  search.set("filter.type", "urn:entity:place");
  if (params.city.trim()) search.set("filter.location.query", params.city.trim());
  if (params.tagIds.length) search.set("signal.interests.tags", params.tagIds.slice(0, 12).join(","));
  if (params.entityIds.length) search.set("signal.interests.entities", params.entityIds.slice(0, 8).join(","));
  search.set("take", String(params.take ?? 16));
  const result = await qlooGet(`/v2/insights?${search.toString()}`);
  if (!result.ok) throw result.error;
  return { entities: parseEntities(result.json), endpoint: result.endpoint };
}

export async function fetchGroupDiningTaste(params: {
  city: string;
  likeQueries: string[];
}): Promise<QlooTasteResult> {
  const usedSignals = [...params.likeQueries, params.city].map((item) => item.trim()).filter(Boolean);
  try {
    const tags: QlooTag[] = [];
    const resolved: QlooEntity[] = [];
    for (const query of usedSignals.slice(0, 10)) {
      const foundTags = await searchQlooTags(query);
      for (const tag of foundTags) {
        if (!tags.some((item) => item.tagId === tag.tagId)) tags.push(tag);
      }
      const foundEntities = await searchQlooEntities(query);
      for (const entity of foundEntities) {
        if (!resolved.some((item) => item.entityId === entity.entityId)) resolved.push(entity);
      }
    }
    const tagIds = tags.slice(0, 8).map((tag) => tag.tagId);
    const entityIds = resolved.slice(0, 6).map((entity) => entity.entityId);
    if (tagIds.length === 0 && entityIds.length === 0) {
      return {
        source: "fallback",
        queriedAt: new Date().toISOString(),
        endpoint: `${getQlooApiBaseUrl()}/v2/tags`,
        tags: [],
        entities: [],
        errorKind: "empty",
        error: "Qloo returned no tags or entities for the group's stated likes.",
        usedSignals,
      };
    }
    const places = await fetchQlooPlaceInsights({
      city: params.city,
      tagIds,
      entityIds,
      take: 16,
    });
    const hasData = places.entities.length > 0;
    return {
      source: hasData ? "qloo" : "fallback",
      queriedAt: new Date().toISOString(),
      endpoint: places.endpoint,
      tags: tags.slice(0, 16),
      entities: hasData ? places.entities.slice(0, 16) : resolved.slice(0, 8),
      errorKind: hasData ? undefined : "empty",
      error: hasData
        ? undefined
        : "Qloo returned no restaurant or place candidates for that city and those signals.",
      usedSignals,
    };
  } catch (err) {
    if (err instanceof QlooClientError) return fallbackResult(err, usedSignals);
    return fallbackResult(
      new QlooClientError("unavailable", err instanceof Error ? err.message : "Qloo request failed."),
      usedSignals
    );
  }
}

function uniqueSignals(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Travel uses Qloo place insights for the destination, not décor-style tags.
 * Tags are fetched in parallel and never block the city place lookup.
 */
export async function fetchTravelTaste(params: {
  destination: string;
  interests: string[];
  extraQueries: string[];
}): Promise<QlooTasteResult> {
  const usedSignals = uniqueSignals([
    params.destination,
    ...params.interests,
    ...params.extraQueries,
  ]);

  try {
    const interestQueries = uniqueSignals([...params.interests, ...params.extraQueries]).slice(0, 3);
    const tagsPromise = Promise.all(
      interestQueries.map(async (query) => {
        try {
          return await searchQlooTags(query);
        } catch (err) {
          if (
            err instanceof QlooClientError &&
            (err.kind === "missing_key" || err.kind === "unauthorized" || err.kind === "rate_limited")
          ) {
            throw err;
          }
          return [] as QlooTag[];
        }
      })
    );
    const placesPromise = fetchQlooPlaceInsights({
      city: params.destination,
      tagIds: [],
      entityIds: [],
      take: 16,
    });
    const [tagBatches, places] = await Promise.all([tagsPromise, placesPromise]);
    const tags: QlooTag[] = [];
    for (const batch of tagBatches) {
      for (const tag of batch) {
        if (!tags.some((item) => item.tagId === tag.tagId)) tags.push(tag);
      }
    }
    const hasPlaces = places.entities.length > 0;
    return {
      source: hasPlaces ? "qloo" : "fallback",
      queriedAt: new Date().toISOString(),
      endpoint: places.endpoint,
      tags: tags.slice(0, 16),
      entities: places.entities.slice(0, 16),
      errorKind: hasPlaces ? undefined : "empty",
      error: hasPlaces
        ? undefined
        : "Qloo returned no place candidates for that destination. WAVE did not invent venues.",
      usedSignals,
    };
  } catch (err) {
    if (err instanceof QlooClientError) return fallbackResult(err, usedSignals);
    return fallbackResult(
      new QlooClientError("unavailable", err instanceof Error ? err.message : "Qloo request failed."),
      usedSignals
    );
  }
}
