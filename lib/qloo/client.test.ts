import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fetchLightingTaste, QlooClientError, searchQlooTags } from "./client";

const originalFetch = globalThis.fetch;
const originalKey = process.env.QLOO_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.QLOO_API_KEY;
  else process.env.QLOO_API_KEY = originalKey;
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
  });
});
