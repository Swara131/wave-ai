import type { ToolExecutionOutcome } from "../../runtime/types";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

export const TAVILY_API_KEY_ENV = "TAVILY_API_KEY";
export const BRAVE_SEARCH_API_KEY_ENV = "BRAVE_SEARCH_API_KEY";

export interface WebSearchResultItem {
  title: string;
  url: string;
  description: string;
}

function unwrapEnvValue(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  const value = (quoted ? trimmed.slice(1, -1) : trimmed).trim();
  return value || undefined;
}

export function readTavilyApiKey(): string | undefined {
  return unwrapEnvValue(process.env[TAVILY_API_KEY_ENV]);
}

export function readBraveSearchApiKey(): string | undefined {
  return unwrapEnvValue(process.env[BRAVE_SEARCH_API_KEY_ENV]);
}

export function isWebSearchConfigured(): boolean {
  return Boolean(readTavilyApiKey() || readBraveSearchApiKey());
}

export function tavilyHttpErrorMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "Tavily rejected the API key (unauthorized). Confirm TAVILY_API_KEY in .env.local is a valid server key from the Tavily dashboard, then restart the server.";
  }
  if (status === 429) {
    return "Tavily rate limit reached. Wait before searching again, or check your Tavily plan.";
  }
  if (status === 402) {
    return "Tavily reported insufficient credits. Check your Tavily account usage.";
  }
  return `Tavily Search API returned ${status}.`;
}

export function tavilyErrorCode(status: number): string {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status === 402) return "insufficient_credits";
  return "tavily_error";
}

function normalizeCount(input: Record<string, unknown>): number {
  if (typeof input.count === "number" && input.count > 0 && input.count <= 10) {
    return Math.floor(input.count);
  }
  return 5;
}

async function searchWithTavily(
  query: string,
  count: number
): Promise<
  | { results: WebSearchResultItem[]; provider: "tavily"; answer?: string }
  | { error: string; errorCode: string; status?: number }
> {
  const apiKey = readTavilyApiKey();
  if (!apiKey) {
    return {
      error: "Tavily is not configured. Set TAVILY_API_KEY in .env.local and restart the server.",
      errorCode: "not_configured",
    };
  }

  try {
    const response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: count,
        include_answer: true,
      }),
    });

    if (!response.ok) {
      await response.text().catch(() => "");
      return {
        error: tavilyHttpErrorMessage(response.status),
        errorCode: tavilyErrorCode(response.status),
        status: response.status,
      };
    }

    const payload = (await response.json()) as {
      answer?: string;
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };

    const results =
      payload.results?.map((item) => ({
        title: item.title?.trim() || "Untitled result",
        url: item.url?.trim() || "",
        description: item.content?.trim() || "",
      })) ?? [];

    const answer = payload.answer?.trim() || undefined;

    return { results, provider: "tavily", answer };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Tavily search failed.",
      errorCode: "tavily_error",
    };
  }
}

async function searchWithBrave(
  query: string,
  count: number
): Promise<
  | { results: WebSearchResultItem[]; provider: "brave" }
  | { error: string; errorCode: string; status?: number }
> {
  const apiKey = readBraveSearchApiKey();
  if (!apiKey) {
    return {
      error: "Brave Search is not configured. Set BRAVE_SEARCH_API_KEY in .env.local and restart the server.",
      errorCode: "not_configured",
    };
  }

  try {
    const url = new URL(BRAVE_SEARCH_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
    });

    if (!response.ok) {
      await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        return {
          error:
            "Brave Search rejected the API key (unauthorized). Confirm BRAVE_SEARCH_API_KEY in .env.local, then restart the server.",
          errorCode: "unauthorized",
          status: response.status,
        };
      }
      if (response.status === 429) {
        return {
          error: "Brave Search rate limit reached. Wait before searching again.",
          errorCode: "rate_limited",
          status: response.status,
        };
      }
      return {
        error: `Brave Search API returned ${response.status}.`,
        errorCode: "brave_error",
        status: response.status,
      };
    }

    const payload = (await response.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    };

    const results =
      payload.web?.results?.map((item) => ({
        title: item.title?.trim() || "Untitled result",
        url: item.url?.trim() || "",
        description: item.description?.trim() || "",
      })) ?? [];

    return { results, provider: "brave" };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Brave search failed.",
      errorCode: "brave_error",
    };
  }
}

export async function handleWebSearch(
  input: Record<string, unknown>
): Promise<ToolExecutionOutcome> {
  const query =
    (typeof input.query === "string" && input.query.trim()) ||
    (typeof input.q === "string" && input.q.trim()) ||
    "";

  if (!query) {
    return {
      executed: false,
      error: "web_search requires a query.",
      output: {},
    };
  }

  if (!isWebSearchConfigured()) {
    return {
      executed: false,
      error:
        "Web search is not configured. Set TAVILY_API_KEY or BRAVE_SEARCH_API_KEY in .env.local and restart the server.",
      output: { query, errorCode: "not_configured" },
    };
  }

  const count = normalizeCount(input);

  if (readTavilyApiKey()) {
    const tavily = await searchWithTavily(query, count);
    if ("results" in tavily) {
      return {
        executed: true,
        output: {
          query,
          provider: tavily.provider,
          results: tavily.results,
          resultCount: tavily.results.length,
          ...(tavily.answer ? { answer: tavily.answer } : {}),
        },
      };
    }

    if (readBraveSearchApiKey()) {
      const brave = await searchWithBrave(query, count);
      if ("results" in brave) {
        return {
          executed: true,
          output: {
            query,
            provider: brave.provider,
            results: brave.results,
            resultCount: brave.results.length,
          },
        };
      }
      return {
        executed: false,
        error: brave.error,
        output: {
          query,
          errorCode: brave.errorCode,
          ...(brave.status ? { status: brave.status } : {}),
          fallbackFrom: "tavily",
        },
      };
    }

    return {
      executed: false,
      error: tavily.error,
      output: {
        query,
        errorCode: tavily.errorCode,
        ...(tavily.status ? { status: tavily.status } : {}),
      },
    };
  }

  const brave = await searchWithBrave(query, count);
  if ("results" in brave) {
    return {
      executed: true,
      output: {
        query,
        provider: brave.provider,
        results: brave.results,
        resultCount: brave.results.length,
      },
    };
  }

  return {
    executed: false,
    error: brave.error,
    output: {
      query,
      errorCode: brave.errorCode,
      ...(brave.status ? { status: brave.status } : {}),
    },
  };
}
