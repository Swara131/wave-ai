import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyGeminiImageError, GeminiImageError, imageGenerationUserMessage } from "./errors";

describe("classifyGeminiImageError", () => {
  it("treats missing configuration as a setup error", () => {
    const message = imageGenerationUserMessage(new Error("GEMINI_API_KEY is not configured."));
    assert.match(message, /GEMINI_API_KEY/);
    assert.doesNotMatch(message, /rate limit/i);
  });

  it("classifies invalid API keys separately from quota", () => {
    const error = classifyGeminiImageError({
      httpStatus: 400,
      payload: { error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key." } },
    });
    assert.equal(error.kind, "invalid_api_key");
    assert.equal(error.retryable, false);
    assert.doesNotMatch(error.message, /rate limit/i);
  });

  it("does not treat free-tier quota 0 as a temporary rate limit", () => {
    const error = classifyGeminiImageError({
      httpStatus: 429,
      payload: {
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          message:
            "You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: generate_content_free_tier_requests, limit: 0",
          details: [
            {
              violations: [
                {
                  quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
                  quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
                  quotaValue: "0",
                  quotaDimensions: { model: "gemini-3.1-flash-image" },
                },
              ],
            },
          ],
        },
      },
    });
    assert.equal(error.kind, "quota");
    assert.equal(error.retryable, false);
    assert.match(error.message, /no free-tier quota/i);
    assert.doesNotMatch(error.message, /Wait a moment and try once more/);
  });

  it("marks per-minute 429s without a zero free-tier limit as retryable rate limits", () => {
    const error = classifyGeminiImageError({
      httpStatus: 429,
      retryAfter: "2",
      payload: {
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
      },
    });
    assert.equal(error.kind, "rate_limit");
    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterMs, 2000);
  });

  it("keeps GeminiImageError messages intact", () => {
    const original = new GeminiImageError({
      kind: "quota",
      message: "Quota is exhausted.",
      retryable: false,
    });
    assert.equal(imageGenerationUserMessage(original), "Quota is exhausted.");
  });
});
