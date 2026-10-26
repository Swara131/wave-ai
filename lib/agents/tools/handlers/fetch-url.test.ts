import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { handleFetchUrl, resolveFetchUrl } from "./fetch-url";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.TAVILY_API_KEY;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetch_url", () => {
  it("rejects missing and private URLs without inventing content", async () => {
    const missing = await handleFetchUrl({});
    assert.equal(missing.executed, false);
    assert.match(missing.error ?? "", /url/i);

    const local = await handleFetchUrl({ url: "http://127.0.0.1/secret" });
    assert.equal(local.executed, false);
    assert.match(local.error ?? "", /internal/i);
  });

  it("extracts a public page title and text", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("tavily.com")) {
        return jsonResponse({ results: [] }, 401);
      }
      return new Response(
        "<html><head><title>Real Article</title><meta name=\"description\" content=\"Live facts.\"></head><body><p>Published findings from the source.</p></body></html>",
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }) as typeof fetch;

    const result = await handleFetchUrl({ url: "https://example.com/article" });
    assert.equal(result.executed, true);
    assert.equal(result.output.title, "Real Article");
    assert.match(String(result.output.text), /Published findings/);
  });

  it("uses YouTube oEmbed and does not invent a transcript", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oembed")) {
        return jsonResponse({ title: "Conference talk", author_name: "Ada" });
      }
      if (url.includes("tavily.com")) {
        return jsonResponse({ results: [] }, 401);
      }
      return new Response("blocked", { status: 403 });
    }) as typeof fetch;

    const result = await handleFetchUrl({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    assert.equal(result.executed, true);
    assert.equal(result.output.title, "Conference talk");
    assert.equal(result.output.transcriptAvailable, false);
    assert.match(String(result.output.warning), /transcript/i);
  });

  it("reads a URL from the task when the tool input is empty", () => {
    assert.equal(
      resolveFetchUrl({}, "Summarize https://youtu.be/dQw4w9WgXcQ please"),
      "https://youtu.be/dQw4w9WgXcQ"
    );
  });
});
