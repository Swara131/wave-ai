import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  handleWebSearch,
  isWebSearchConfigured,
  readTavilyApiKey,
  tavilyErrorCode,
  tavilyHttpErrorMessage,
} from "./web-search";

const ORIGINAL_ENV = { ...process.env };
const originalFetch = globalThis.fetch;

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = originalFetch;
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Tavily configuration", () => {
  it("reads TAVILY_API_KEY and strips wrapping quotes", () => {
    delete process.env.BRAVE_SEARCH_API_KEY;
    process.env.TAVILY_API_KEY = '"tvly-test-key"';
    assert.equal(readTavilyApiKey(), "tvly-test-key");
    assert.equal(isWebSearchConfigured(), true);
  });

  it("treats an empty TAVILY_API_KEY as missing", () => {
    process.env.TAVILY_API_KEY = "   ";
    delete process.env.BRAVE_SEARCH_API_KEY;
    assert.equal(readTavilyApiKey(), undefined);
    assert.equal(isWebSearchConfigured(), false);
  });
});

describe("tavilyHttpErrorMessage", () => {
  it("distinguishes unauthorized, rate limit, and other statuses", () => {
    assert.match(tavilyHttpErrorMessage(401), /unauthorized/i);
    assert.match(tavilyHttpErrorMessage(403), /unauthorized/i);
    assert.match(tavilyHttpErrorMessage(429), /rate limit/i);
    assert.match(tavilyHttpErrorMessage(500), /returned 500/);
    assert.equal(tavilyErrorCode(401), "unauthorized");
    assert.equal(tavilyErrorCode(429), "rate_limited");
    assert.equal(tavilyErrorCode(500), "tavily_error");
  });
});

describe("handleWebSearch", () => {
  it("reports missing configuration without calling Tavily", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return jsonResponse(200, {});
    }) as typeof fetch;

    const result = await handleWebSearch({ query: "latest AI news" });
    assert.equal(result.executed, false);
    assert.match(result.error ?? "", /not configured/i);
    assert.equal(result.output.errorCode, "not_configured");
    assert.equal(called, false);
  });

  it("sends Authorization Bearer and does not put the key in the JSON body", async () => {
    process.env.TAVILY_API_KEY = "tvly-test-key";
    delete process.env.BRAVE_SEARCH_API_KEY;
    let capturedHeaders: Headers | undefined;
    let capturedBody = "";

    globalThis.fetch = (async (_url, init) => {
      capturedHeaders = new Headers(init?.headers);
      capturedBody = String(init?.body ?? "");
      return jsonResponse(200, {
        answer: "A short answer",
        results: [{ title: "Example", url: "https://example.test", content: "snippet" }],
      });
    }) as typeof fetch;

    const result = await handleWebSearch({ query: "latest AI news" });
    assert.equal(result.executed, true);
    assert.equal(capturedHeaders?.get("Authorization"), "Bearer tvly-test-key");
    assert.equal(capturedHeaders?.get("Content-Type"), "application/json");
    const body = JSON.parse(capturedBody) as Record<string, unknown>;
    assert.equal(body.api_key, undefined);
    assert.equal(body.query, "latest AI news");
    assert.equal(result.output.provider, "tavily");
    assert.doesNotMatch(JSON.stringify(result), /tvly-test-key/);
  });

  it("surfaces a 401 as invalid credentials", async () => {
    process.env.TAVILY_API_KEY = "tvly-invalid";
    delete process.env.BRAVE_SEARCH_API_KEY;
    globalThis.fetch = (async () =>
      jsonResponse(401, { detail: { error: "Unauthorized: missing or invalid API key." } })) as typeof fetch;

    const result = await handleWebSearch({ query: "latest AI news" });
    assert.equal(result.executed, false);
    assert.match(result.error ?? "", /unauthorized/i);
    assert.equal(result.output.errorCode, "unauthorized");
    assert.equal(result.output.status, 401);
    assert.doesNotMatch(JSON.stringify(result), /tvly-invalid/);
  });

  it("surfaces a 429 as a rate limit", async () => {
    process.env.TAVILY_API_KEY = "tvly-test-key";
    delete process.env.BRAVE_SEARCH_API_KEY;
    globalThis.fetch = (async () => jsonResponse(429, { detail: { error: "rate limit" } })) as typeof fetch;

    const result = await handleWebSearch({ query: "latest AI news" });
    assert.equal(result.executed, false);
    assert.match(result.error ?? "", /rate limit/i);
    assert.equal(result.output.errorCode, "rate_limited");
    assert.equal(result.output.status, 429);
  });

  it("surfaces other Tavily HTTP errors without inventing success", async () => {
    process.env.TAVILY_API_KEY = "tvly-test-key";
    delete process.env.BRAVE_SEARCH_API_KEY;
    globalThis.fetch = (async () => jsonResponse(503, { detail: { error: "unavailable" } })) as typeof fetch;

    const result = await handleWebSearch({ query: "latest AI news" });
    assert.equal(result.executed, false);
    assert.match(result.error ?? "", /returned 503/);
    assert.equal(result.output.errorCode, "tavily_error");
  });
});
