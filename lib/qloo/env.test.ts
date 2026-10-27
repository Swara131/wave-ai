import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  getQlooApiBaseUrl,
  QLOO_HACKATHON_API_BASE_URL,
  shouldRetryQlooOnHackathon,
  unauthorizedQlooMessage,
} from "./env";

const originalBase = process.env.QLOO_API_BASE_URL;
const originalCommercial = process.env.QLOO_API_USE_COMMERCIAL;

afterEach(() => {
  if (originalBase === undefined) delete process.env.QLOO_API_BASE_URL;
  else process.env.QLOO_API_BASE_URL = originalBase;
  if (originalCommercial === undefined) delete process.env.QLOO_API_USE_COMMERCIAL;
  else process.env.QLOO_API_USE_COMMERCIAL = originalCommercial;
});

describe("Qloo env host", () => {
  it("defaults to the hackathon Insights host", () => {
    delete process.env.QLOO_API_BASE_URL;
    delete process.env.QLOO_API_USE_COMMERCIAL;
    assert.equal(getQlooApiBaseUrl(), QLOO_HACKATHON_API_BASE_URL);
  });

  it("rewrites commercial Qloo hosts to hackathon unless opted in", () => {
    delete process.env.QLOO_API_USE_COMMERCIAL;
    process.env.QLOO_API_BASE_URL = "https://api.qloo.com/";
    assert.equal(getQlooApiBaseUrl(), QLOO_HACKATHON_API_BASE_URL);
  });

  it("keeps a commercial host when QLOO_API_USE_COMMERCIAL=true", () => {
    process.env.QLOO_API_USE_COMMERCIAL = "true";
    process.env.QLOO_API_BASE_URL = "https://api.qloo.com";
    assert.equal(getQlooApiBaseUrl(), "https://api.qloo.com");
  });

  it("retries unauthorized calls that were not already on the hackathon host", () => {
    assert.equal(shouldRetryQlooOnHackathon("https://api.qloo.com"), true);
    assert.equal(shouldRetryQlooOnHackathon(QLOO_HACKATHON_API_BASE_URL), false);
    assert.match(unauthorizedQlooMessage(401), /hackathon\.api\.qloo\.com/);
  });
});
