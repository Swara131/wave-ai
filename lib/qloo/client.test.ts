import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fetchLightingTaste, QlooClientError, searchQlooTags } from "./client";

const originalFetch = globalThis.fetch;
const originalKey = process.env.QLOO_API_KEY;
const originalBase = process.env.QLOO_API_BASE_URL;
const originalCommercial = process.env.QLOO_API_USE_COMMERCIAL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.QLOO_API_KEY;
  else process.env.QLOO_API_KEY = originalKey;
  if (originalBase === undefined) delete process.env.QLOO_API_BASE_URL;
  else process.env.QLOO_API_BASE_URL = originalBase;
  if (originalCommercial === undefined) delete process.env.QLOO_API_USE_COMMERCIAL;
  else process.env.QLOO_API_USE_COMMERCIAL = originalCommercial;
});

describe("Qloo lighting taste client", () => {
  it("falls back when the API key is missing", async () => {
    delete process.env.QLOO_API_KEY;
    const result = await fetchLightingTaste({ style: "minimalist", extraQueries: [] });
    assert.equal(result.source, "fallback");
    assert.equal(result.errorKind, "missing_key");
    assert.equal(result.tags.length, 0);
  });

  it("returns real tags when Qloo search succeeds", async () => {
    process.env.QLOO_API_KEY = "test-qloo-key";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v2/tags")) {
        return new Response(
          JSON.stringify({
            success: true,
            results: { tags: [{ tag_id: "urn:tag:keyword:lifestyle:minimalist", name: "Minimalist" }] },
          }),
          { status: 200 }
        );
      }
      if (url.includes("filter.type=urn%3Atag") || url.includes("filter.type=urn:tag")) {
        return new Response(
          JSON.stringify({
            success: true,
            results: { tags: [{ tag_id: "urn:tag:keyword:lifestyle:scandinavian", name: "Scandinavian" }] },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ success: true, results: { entities: [] } }), { status: 200 });
    }) as typeof fetch;

    const result = await fetchLightingTaste({ style: "minimalist", extraQueries: [] });
    assert.equal(result.source, "qloo");
    assert.ok(result.tags.some((tag) => tag.name === "Scandinavian"));
    assert.equal(result.errorKind, undefined);
  });

  it("falls back on an empty Qloo result", async () => {
    process.env.QLOO_API_KEY = "test-qloo-key";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: true, results: { tags: [] } }), { status: 200 })) as typeof fetch;
    const result = await fetchLightingTaste({ style: "industrial", extraQueries: [] });
    assert.equal(result.source, "fallback");
    assert.equal(result.errorKind, "empty");
  });

  it("does not retry tag search after a timeout", async () => {
    process.env.QLOO_API_KEY = "test-qloo-key";
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as typeof fetch;
    await assert.rejects(() => searchQlooTags("modern"), (err: unknown) => {
      assert.ok(err instanceof QlooClientError);
      assert.equal(err.kind, "timeout");
      return true;
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].includes("filter.query"), false);
  });

  it("classifies rate limits", async () => {
    process.env.QLOO_API_KEY = "test-qloo-key";
    globalThis.fetch = (async () => new Response("slow down", { status: 429 })) as typeof fetch;
    await assert.rejects(() => searchQlooTags("modern"), (err: unknown) => {
      assert.ok(err instanceof QlooClientError);
      assert.equal(err.kind, "rate_limited");
      return true;
    });
    const result = await fetchLightingTaste({ style: "modern", extraQueries: [] });
    assert.equal(result.source, "fallback");
    assert.equal(result.errorKind, "rate_limited");
  });

  it("classifies authentication errors", async () => {
    process.env.QLOO_API_KEY = "test-qloo-key";
    globalThis.fetch = (async () => new Response("nope", { status: 401 })) as typeof fetch;
    const result = await fetchLightingTaste({ style: "classic", extraQueries: [] });
    assert.equal(result.source, "fallback");
    assert.equal(result.errorKind, "unauthorized");
    assert.match(result.error ?? "", /hackathon\.api\.qloo\.com/);
  });

  it("retries the hackathon host after a commercial 401", async () => {
    process.env.QLOO_API_KEY = "test-qloo-key";
    process.env.QLOO_API_USE_COMMERCIAL = "true";
    process.env.QLOO_API_BASE_URL = "https://api.qloo.com";
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      if (url.startsWith("https://api.qloo.com")) {
        return new Response("nope", { status: 401 });
      }
      if (url.includes("/v2/tags")) {
        return new Response(
          JSON.stringify({
            success: true,
            results: { tags: [{ tag_id: "urn:tag:keyword:lifestyle:classic", name: "Classic" }] },
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          results: { tags: [{ tag_id: "urn:tag:keyword:lifestyle:heritage", name: "Heritage" }] },
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const result = await fetchLightingTaste({ style: "classic", extraQueries: [] });
    assert.equal(result.source, "qloo");
    assert.ok(seen.some((url) => url.startsWith("https://api.qloo.com")));
    assert.ok(seen.some((url) => url.startsWith("https://hackathon.api.qloo.com")));
  });
});
