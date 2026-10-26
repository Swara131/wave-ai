import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import { isSupportedConnectionMethod } from "./connection-methods";
import { testExternalAgentConnection } from "./test-connection";

function listen(
  handler: http.RequestListener
): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to bind test server."));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

describe("isSupportedConnectionMethod", () => {
  it("accepts rest_api, webhook, and sdk", () => {
    assert.equal(isSupportedConnectionMethod("rest_api"), true);
    assert.equal(isSupportedConnectionMethod("webhook"), true);
    assert.equal(isSupportedConnectionMethod("sdk"), true);
  });

  it("rejects mcp and unknown methods", () => {
    assert.equal(isSupportedConnectionMethod("mcp"), false);
    assert.equal(isSupportedConnectionMethod("langchain"), false);
  });
});

describe("testExternalAgentConnection validation", () => {
  it("fails when REST endpoint is missing", async () => {
    const result = await testExternalAgentConnection({ method: "rest_api" });
    assert.equal(result.passed, false);
    assert.equal(result.checks[0]?.message, "Agent endpoint is required.");
  });

  it("fails a malformed endpoint URL", async () => {
    const result = await testExternalAgentConnection({
      method: "rest_api",
      endpointUrl: "not a url",
    });
    assert.equal(result.passed, false);
    assert.equal(result.checks[0]?.status, "fail");
    assert.match(result.checks[0]?.message ?? "", /Invalid endpoint URL/);
  });

  it("fails an unsupported protocol", async () => {
    const result = await testExternalAgentConnection({
      method: "webhook",
      endpointUrl: "ftp://example.invalid/hook",
    });
    assert.equal(result.passed, false);
    assert.match(result.checks[0]?.message ?? "", /http or https/);
  });

  it("fails SDK tests without an agent ID", async () => {
    const result = await testExternalAgentConnection({ method: "sdk", apiKey: "al_x" });
    assert.equal(result.passed, false);
    assert.match(result.summary, /Agent ID is required/);
  });

  it("fails SDK tests without an API key", async () => {
    const result = await testExternalAgentConnection({
      method: "sdk",
      agentId: "demo-agent",
      apiKey: "",
    });
    assert.equal(result.passed, false);
    assert.match(result.checks[0]?.message ?? "", /API key is required/);
  });
});

describe("testExternalAgentConnection HTTP (local mock endpoints)", () => {
  it("fails a closed local port", async () => {
    const result = await testExternalAgentConnection({
      method: "rest_api",
      endpointUrl: "http://127.0.0.1:1/",
    });
    assert.equal(result.passed, false);
    assert.equal(result.checks[0]?.status, "fail");
  });

  it("fails HTTP 500 handshake", async () => {
    const { server, url } = await listen((_req, res) => {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain");
      res.end("internal error");
    });
    try {
      const result = await testExternalAgentConnection({
        method: "rest_api",
        endpointUrl: url,
      });
      assert.equal(result.passed, false);
      assert.match(result.checks[0]?.message ?? "", /Handshake failed \(HTTP 500/);
    } finally {
      server.close();
    }
  });

  it("fails HTTP 401 as authentication failure", async () => {
    const { server, url } = await listen((_req, res) => {
      res.statusCode = 401;
      res.end("unauthorized");
    });
    try {
      const result = await testExternalAgentConnection({
        method: "rest_api",
        endpointUrl: url,
        authType: "bearer",
        authToken: "invalid-token",
      });
      assert.equal(result.passed, false);
      assert.match(result.checks[0]?.message ?? "", /Authentication failed/);
    } finally {
      server.close();
    }
  });

  it("passes a local 200 JSON handshake (simulated endpoint)", async () => {
    const { server, url } = await listen((req, res) => {
      assert.equal(req.method, "GET");
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, service: "mock-agent" }));
    });
    try {
      const result = await testExternalAgentConnection({
        method: "rest_api",
        endpointUrl: url,
      });
      assert.equal(result.passed, true);
      assert.equal(result.safetyEligible, false);
    } finally {
      server.close();
    }
  });

  it("posts a webhook test payload and passes on 200", async () => {
    let received = "";
    const { server, url } = await listen(async (req, res) => {
      assert.equal(req.method, "POST");
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      received = Buffer.concat(chunks).toString("utf8");
      res.statusCode = 200;
      res.end("ok");
    });
    try {
      const result = await testExternalAgentConnection({
        method: "webhook",
        endpointUrl: url,
      });
      assert.equal(result.passed, true);
      const body = JSON.parse(received) as { type?: string };
      assert.equal(body.type, "zelta.test");
    } finally {
      server.close();
    }
  });
});
