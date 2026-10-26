import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { GeminiImageError } from "./errors";
import { generateGeminiImage, type GeminiFetch } from "./gemini-image";

const previousKey = process.env.GEMINI_API_KEY;
const previousModel = process.env.GEMINI_IMAGE_MODEL;

afterEach(() => {
  if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = previousKey;
  if (previousModel === undefined) delete process.env.GEMINI_IMAGE_MODEL;
  else process.env.GEMINI_IMAGE_MODEL = previousModel;
});

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("generateGeminiImage", () => {
  it("fails honestly when GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    await assert.rejects(
      () =>
        generateGeminiImage({
          prompt: "A blue circle",
          title: "Test",
          nowConfigured: false,
          fetchImpl: async () => {
            throw new Error("network should not run");
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof GeminiImageError);
        assert.equal(err.kind, "missing_config");
        assert.equal(err.retryable, false);
        return true;
      }
    );
  });

  it("classifies an invalid API key without retrying", async () => {
    process.env.GEMINI_API_KEY = "test-invalid-key";
    process.env.GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
    let calls = 0;
    const fetchImpl: GeminiFetch = async () => {
      calls += 1;
      return jsonResponse(400, {
        error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key." },
      });
    };
    await assert.rejects(
      () => generateGeminiImage({ prompt: "A blue circle", title: "Test", fetchImpl }),
      (err: unknown) => {
        assert.ok(err instanceof GeminiImageError);
        assert.equal(err.kind, "invalid_api_key");
        assert.equal(err.retryable, false);
        return true;
      }
    );
    assert.equal(calls, 1);
  });

  it("does not retry exhausted free-tier quota", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
    let calls = 0;
    const fetchImpl: GeminiFetch = async () => {
      calls += 1;
      return jsonResponse(429, {
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          message: "You exceeded your current quota, please check your plan and billing details. limit: 0",
          details: [
            {
              violations: [
                {
                  quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
                  quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
                  quotaValue: "0",
                },
              ],
            },
          ],
        },
      });
    };
    await assert.rejects(
      () => generateGeminiImage({ prompt: "A blue circle", title: "Test", fetchImpl }),
      (err: unknown) => {
        assert.ok(err instanceof GeminiImageError);
        assert.equal(err.kind, "quota");
        assert.equal(err.retryable, false);
        return true;
      }
    );
    assert.equal(calls, 1);
  });

  it("retries a genuine rate limit and then returns the generated image", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
    let calls = 0;
    const fetchImpl: GeminiFetch = async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(429, {
          error: {
            code: 429,
            status: "RESOURCE_EXHAUSTED",
            message: "Resource has been exhausted (e.g. check quota).",
            details: [
              {
                violations: [
                  {
                    quotaMetric: "generativelanguage.googleapis.com/generate_content_requests",
                    quotaId: "GenerateRequestsPerMinutePerProjectPerModel",
                  },
                ],
              },
            ],
          },
        });
      }
      return jsonResponse(200, {
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: "image/png", data: "aGVsbG8=" } }],
            },
          },
        ],
      });
    };
    const result = await generateGeminiImage({ prompt: "A blue circle", title: "Test", fetchImpl });
    assert.equal(calls, 2);
    assert.equal(result.model, "gemini-3.1-flash-image");
    assert.equal(result.dataUrl, "data:image/png;base64,aGVsbG8=");
  });

  it("returns the provider image on success", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
    const fetchImpl: GeminiFetch = async (_url, init) => {
      assert.match(String(init.headers && (init.headers as Record<string, string>)["x-goog-api-key"]), /test-key/);
      assert.doesNotMatch(_url, /key=/);
      return jsonResponse(200, {
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: "image/png", data: "ZmFrZQ==" } }],
            },
          },
        ],
      });
    };
    const result = await generateGeminiImage({ prompt: "A blue circle", title: "Test", fetchImpl });
    assert.ok(result.dataUrl.startsWith("data:image/png;base64,"));
  });
});
