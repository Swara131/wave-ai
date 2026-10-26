import { isBlockedHost } from "@/lib/http/outbound-url";
import type { ToolExecutionOutcome } from "../../runtime/types";

const MAX_RESPONSE_BYTES = 32_768;
const DEFAULT_TIMEOUT_MS = 15_000;

export async function handleHttpRequest(
  input: Record<string, unknown>
): Promise<ToolExecutionOutcome> {
  const url = typeof input.url === "string" ? input.url.trim() : "";
  const method =
    typeof input.method === "string" ? input.method.trim().toUpperCase() : "GET";

  if (!url) {
    return {
      executed: false,
      error: "http_request requires a url.",
      output: {},
    };
  }

  if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method)) {
    return {
      executed: false,
      error: "Unsupported HTTP method.",
      output: { method },
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      executed: false,
      error: "Invalid URL.",
      output: { url },
    };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return {
      executed: false,
      error: "Only http and https URLs are allowed.",
      output: { url },
    };
  }

  if (isBlockedHost(parsed.hostname)) {
    return {
      executed: false,
      error: "Requests to internal or local addresses are not allowed.",
      output: { url },
    };
  }

  const headers: Record<string, string> = {};
  if (input.headers && typeof input.headers === "object" && !Array.isArray(input.headers)) {
    for (const [key, value] of Object.entries(input.headers)) {
      if (typeof value === "string") headers[key] = value;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const body =
      input.body && typeof input.body === "object" && method !== "GET" && method !== "HEAD"
        ? JSON.stringify(input.body)
        : undefined;

    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json, text/plain, */*",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body,
      signal: controller.signal,
    });

    const text = await response.text();
    const truncated = text.slice(0, MAX_RESPONSE_BYTES);

    let parsedBody: unknown = truncated;
    try {
      parsedBody = JSON.parse(truncated);
    } catch {
      /* keep text */
    }

    return {
      executed: true,
      output: {
        status: response.status,
        ok: response.ok,
        url,
        method,
        body: parsedBody,
        truncated: text.length > MAX_RESPONSE_BYTES,
      },
    };
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "HTTP request timed out."
        : err instanceof Error
          ? err.message
          : "HTTP request failed.";
    return {
      executed: false,
      error: message,
      output: { url, method },
    };
  } finally {
    clearTimeout(timer);
  }
}
