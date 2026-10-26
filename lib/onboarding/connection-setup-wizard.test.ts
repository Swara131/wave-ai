import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildConnectionCodePlainText,
  mapPlatformToTechStack,
} from "./connection-setup-wizard";

describe("connection setup snippets", () => {
  it("maps n8n and other platforms to custom HTTP, LangChain to langchain", () => {
    assert.equal(mapPlatformToTechStack("n8n"), "custom-http");
    assert.equal(mapPlatformToTechStack("other"), "custom-http");
    assert.equal(mapPlatformToTechStack("langchain"), "langchain");
  });

  it("points copied examples at /api/v1/actions/propose with actionType", () => {
    const stacks = ["nodejs", "python", "custom-http", "langchain"] as const;
    for (const stack of stacks) {
      const code = buildConnectionCodePlainText(stack, {
        agentId: "demo-agent",
        apiKeyPlaceholder: "YOUR_ZELTA_API_KEY",
        baseUrl: "http://localhost:3000",
      });
      assert.match(code, /\/api\/v1\/actions\/propose/);
      assert.doesNotMatch(code, /localhost:3000\/v1\/actions\/propose/);
      assert.match(code, /actionType/);
    }
  });
});
