import type { SupabaseClient } from "@supabase/supabase-js";
import { AgentAuthError } from "@/lib/gateway/errors";
import {
  authenticateAgentApiKey,
  type AuthenticateAgentApiKeyDeps,
} from "@/lib/gateway/keys/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateExternalSafetyEligibility } from "./safety-eligibility";
import type {
  ExternalConnectionMethod,
  ExternalTestCheck,
  ExternalTestResult,
} from "./types";

const TEST_TIMEOUT_MS = 12_000;

function check(
  id: ExternalTestCheck["id"],
  label: string,
  status: ExternalTestCheck["status"],
  message?: string
): ExternalTestCheck {
  return { id, label, status, message };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function testHttpEndpoint(params: {
  endpointUrl: string;
  method: ExternalConnectionMethod;
  authType?: "none" | "bearer" | "api_key_header";
  authToken?: string;
  authHeaderName?: string;
}): Promise<ExternalTestCheck[]> {
  const checks: ExternalTestCheck[] = [];

  let parsed: URL;
  try {
    parsed = new URL(params.endpointUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      checks.push(
        check("connection", "Connection", "fail", "Endpoint must use http or https.")
      );
      return checks;
    }
  } catch {
    checks.push(check("connection", "Connection", "fail", "Invalid endpoint URL."));
    return checks;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "User-Agent": "Zelta-Agent-Test/1.0",
  };

  if (params.authType === "bearer" && params.authToken) {
    headers.Authorization = `Bearer ${params.authToken}`;
  } else if (
    params.authType === "api_key_header" &&
    params.authToken &&
    params.authHeaderName
  ) {
    headers[params.authHeaderName] = params.authToken;
  }

  const body =
    params.method === "webhook"
      ? JSON.stringify({
          type: "zelta.test",
          message: "Wave connection test",
          timestamp: new Date().toISOString(),
        })
      : undefined;

  try {
    const response = await fetchWithTimeout(parsed.toString(), {
      method: params.method === "webhook" ? "POST" : "GET",
      headers,
      body,
    });

    const contentType = response.headers.get("content-type") ?? "";
    let responseText = "";
    try {
      responseText = (await response.text()).slice(0, 2000);
    } catch {
      responseText = "";
    }

    const hasBody = responseText.trim().length > 0;
    const authFailed = response.status === 401 || response.status === 403;

    if (!response.ok) {
      checks.push(
        check(
          "connection",
          "Connection",
          "fail",
          authFailed
            ? `Authentication failed (HTTP ${response.status}).`
            : `Handshake failed (HTTP ${response.status} ${response.statusText || "Request failed"}).`
        )
      );
      checks.push(
        check(
          "response",
          "Agent response",
          "fail",
          hasBody
            ? `HTTP ${response.status}: ${responseText.slice(0, 120)}`
            : `HTTP ${response.status}: ${response.statusText || "Request failed"}.`
        )
      );
      checks.push(
        check("execution", "Execution", "fail", "The endpoint did not accept the test request.")
      );
      checks.push(
        check(
          "output",
          "Output",
          hasBody ? "fail" : "fail",
          hasBody
            ? `Sample: ${responseText.slice(0, 120)}${responseText.length > 120 ? "…" : ""}`
            : contentType
              ? `Content-Type: ${contentType}`
              : "No output returned."
        )
      );
      return checks;
    }

    checks.push(
      check(
        "connection",
        "Connection",
        "pass",
        `Reached ${parsed.host} (${response.status}).`
      )
    );

    checks.push(
      check(
        "response",
        "Agent response",
        "pass",
        hasBody ? "Agent returned a response body." : "Endpoint responded with no body."
      )
    );

    checks.push(
      check("execution", "Execution", "pass", "Endpoint accepted the test request.")
    );

    checks.push(
      check(
        "output",
        "Output",
        "pass",
        hasBody
          ? `Sample: ${responseText.slice(0, 120)}${responseText.length > 120 ? "…" : ""}`
          : contentType
            ? `Content-Type: ${contentType}`
            : "No output returned."
      )
    );
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "Connection timed out."
        : err instanceof Error
          ? err.message
          : "Connection failed.";
    checks.push(check("connection", "Connection", "fail", message));
    checks.push(check("response", "Agent response", "skipped", "Not reached."));
    checks.push(check("execution", "Execution", "skipped", "Not reached."));
    checks.push(check("output", "Output", "skipped", "Not reached."));
  }

  return checks;
}

async function testSdkGateway(params: {
  agentId: string;
  apiKey: string;
  authDeps?: AuthenticateAgentApiKeyDeps;
}): Promise<ExternalTestCheck[]> {
  const checks: ExternalTestCheck[] = [];

  if (!params.apiKey.trim()) {
    checks.push(check("connection", "Connection", "fail", "API key is required for SDK tests."));
    checks.push(check("response", "Agent response", "skipped", "Not run."));
    checks.push(check("execution", "Execution", "skipped", "Not run."));
    checks.push(check("output", "Output", "skipped", "Not run."));
    return checks;
  }

  try {
    const admin = createAdminClient();
    const auth = await authenticateAgentApiKey(
      admin,
      params.apiKey.trim(),
      params.authDeps
    );

    if (auth.agentId !== params.agentId.trim()) {
      checks.push(
        check(
          "connection",
          "Connection",
          "fail",
          "API key belongs to a different agent."
        )
      );
      checks.push(check("response", "Agent response", "skipped", "Not run."));
      checks.push(check("execution", "Execution", "skipped", "Not run."));
      checks.push(check("output", "Output", "skipped", "Not run."));
      return checks;
    }

    checks.push(
      check(
        "connection",
        "Connection",
        "pass",
        `Gateway accepted API key for agent ${auth.agentId}.`
      )
    );
    checks.push(
      check(
        "response",
        "Agent response",
        "pass",
        "Gateway authentication succeeded."
      )
    );
    checks.push(
      check(
        "execution",
        "Execution",
        "pass",
        "Agent can authenticate with the Wave gateway."
      )
    );
    checks.push(
      check(
        "output",
        "Output",
        "pass",
        `Key prefix ${auth.keyPrefix} is active.`
      )
    );
  } catch (err) {
    const message =
      err instanceof AgentAuthError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Gateway authentication failed.";
    checks.push(check("connection", "Connection", "fail", message));
    checks.push(check("response", "Agent response", "skipped", "Not run."));
    checks.push(check("execution", "Execution", "skipped", "Not run."));
    checks.push(check("output", "Output", "skipped", "Not run."));
  }

  return checks;
}

export async function testExternalAgentConnection(
  params: {
    method: ExternalConnectionMethod;
    endpointUrl?: string;
    authType?: "none" | "bearer" | "api_key_header";
    authToken?: string;
    authHeaderName?: string;
    agentId?: string;
    apiKey?: string;
  },
  deps?: { authDeps?: AuthenticateAgentApiKeyDeps }
): Promise<ExternalTestResult> {
  const safety = evaluateExternalSafetyEligibility(params.method);

  let checks: ExternalTestCheck[] = [];

  if (params.method === "sdk") {
    if (!params.agentId) {
      return {
        passed: false,
        needsAttention: true,
        checks: [
          check("connection", "Connection", "fail", "Agent ID is required for SDK tests."),
        ],
        summary: "Agent ID is required.",
        safetyEligible: safety.eligible,
        safetyMessage: safety.message,
      };
    }
    checks = await testSdkGateway({
      agentId: params.agentId,
      apiKey: params.apiKey ?? "",
      authDeps: deps?.authDeps,
    });
  } else {
    if (!params.endpointUrl?.trim()) {
      return {
        passed: false,
        needsAttention: true,
        checks: [check("connection", "Connection", "fail", "Agent endpoint is required.")],
        summary: "Agent endpoint is required.",
        safetyEligible: safety.eligible,
        safetyMessage: safety.message,
      };
    }
    checks = await testHttpEndpoint({
      endpointUrl: params.endpointUrl.trim(),
      method: params.method,
      authType: params.authType,
      authToken: params.authToken,
      authHeaderName: params.authHeaderName,
    });
  }

  const required = checks.filter((item) => item.status !== "skipped");
  const passed = required.length > 0 && required.every((item) => item.status === "pass");
  const needsAttention = !passed && required.some((item) => item.status === "fail");

  return {
    passed,
    needsAttention,
    checks,
    summary: passed
      ? "Test passed."
      : needsAttention
        ? "Test needs attention."
        : "Test did not complete.",
    safetyEligible: safety.eligible,
    safetyMessage: safety.message,
  };
}

/** No-op export for typing in routes that pass supabase — reserved for future audit logging. */
export type ExternalTestSupabase = SupabaseClient;
