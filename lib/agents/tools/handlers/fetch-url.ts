import { extractHttpUrl, parsePublicHttpUrl, youtubeVideoId } from "@/lib/http/outbound-url";
import { readTavilyApiKey } from "./web-search";
import type { ToolExecutionOutcome } from "../../runtime/types";

const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";
const MAX_TEXT_CHARS = 12_000;
const FETCH_TIMEOUT_MS = 15_000;

export interface FetchedWebContent {
  url: string;
  title: string;
  description: string;
  text: string;
  author?: string;
  platform?: string;
  extractLimited: boolean;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html: string, names: string[]): string {
  for (const name of names) {
    const pattern = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
      "i"
    );
    const alt = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,
      "i"
    );
    const match = html.match(pattern) ?? html.match(alt);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
}

function extractFromHtml(html: string, url: string): FetchedWebContent {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title =
    metaContent(html, ["og:title", "twitter:title"]) ||
    stripTags(titleMatch?.[1] ?? "") ||
    url;
  const description = metaContent(html, [
    "og:description",
    "description",
    "twitter:description",
  ]);
  const text = stripTags(html).slice(0, MAX_TEXT_CHARS);
  return {
    url,
    title,
    description,
    text,
    extractLimited: stripTags(html).length > MAX_TEXT_CHARS,
  };
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchYoutubeOEmbed(url: string): Promise<Partial<FetchedWebContent> | null> {
  try {
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = await fetchWithTimeout(endpoint, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      title?: string;
      author_name?: string;
    };
    const title = payload.title?.trim();
    if (!title) return null;
    return {
      title,
      author: payload.author_name?.trim(),
      platform: "youtube",
      description: payload.author_name
        ? `YouTube video by ${payload.author_name.trim()}`
        : "YouTube video",
    };
  } catch {
    return null;
  }
}

async function extractWithTavily(url: string): Promise<string | null> {
  const apiKey = readTavilyApiKey();
  if (!apiKey) return null;
  try {
    const response = await fetchWithTimeout(TAVILY_EXTRACT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ urls: [url] }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      results?: Array<{ raw_content?: string; text?: string }>;
    };
    const content =
      payload.results?.[0]?.raw_content?.trim() || payload.results?.[0]?.text?.trim() || "";
    return content ? content.slice(0, MAX_TEXT_CHARS) : null;
  } catch {
    return null;
  }
}

export function resolveFetchUrl(input: Record<string, unknown>, fallbackTask?: string): string {
  const fromInput =
    (typeof input.url === "string" && input.url.trim()) ||
    (typeof input.source_url === "string" && input.source_url.trim()) ||
    "";
  return fromInput || extractHttpUrl(fallbackTask) || "";
}

export async function handleFetchUrl(
  input: Record<string, unknown>
): Promise<ToolExecutionOutcome> {
  const raw = resolveFetchUrl(input);
  const parsed = parsePublicHttpUrl(raw);
  if (!parsed.ok) {
    return {
      executed: false,
      error: parsed.error,
      output: { url: raw },
    };
  }

  const url = parsed.url.toString();
  const videoId = youtubeVideoId(parsed.url);

  try {
    const [oembed, tavilyText, pageResponse] = await Promise.all([
      videoId ? fetchYoutubeOEmbed(url) : Promise.resolve(null),
      extractWithTavily(url),
      fetchWithTimeout(url, {
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8",
          "User-Agent": "WaveAgent/1.0 (content extract; +https://wave.app)",
        },
      }).catch(() => null),
    ]);

    let htmlExtract: FetchedWebContent | null = null;
    if (pageResponse?.ok) {
      const contentType = pageResponse.headers.get("content-type") ?? "";
      const body = (await pageResponse.text()).slice(0, 400_000);
      if (contentType.includes("json")) {
        htmlExtract = {
          url,
          title: url,
          description: "",
          text: body.slice(0, MAX_TEXT_CHARS),
          extractLimited: body.length > MAX_TEXT_CHARS,
        };
      } else {
        htmlExtract = extractFromHtml(body, url);
      }
    }

    const title = oembed?.title || htmlExtract?.title || url;
    const description = oembed?.description || htmlExtract?.description || "";
    const text = (tavilyText || htmlExtract?.text || "").trim();
    const combined = [title, description, text].filter(Boolean).join("\n\n");

    if (combined.replace(url, "").trim().length < 12) {
      return {
        executed: false,
        error:
          "Wave could not read usable content from that link. The page may be private, blocked, or empty. No summary was invented.",
        output: {
          url,
          status: pageResponse?.status ?? null,
          platform: oembed?.platform ?? (videoId ? "youtube" : "web"),
        },
      };
    }

    const extractLimited =
      Boolean(videoId && !tavilyText) || Boolean(htmlExtract?.extractLimited);

    return {
      executed: true,
      output: {
        url,
        title,
        description,
        author: oembed?.author ?? null,
        platform: oembed?.platform ?? (videoId ? "youtube" : "web"),
        text,
        extractLimited,
        transcriptAvailable: Boolean(videoId) ? Boolean(tavilyText && tavilyText.length > 200) : null,
        warning:
          videoId && !tavilyText
            ? "Full video transcript was not available. Summarize only the title, channel, and any extracted description — do not invent what was said in the video."
            : null,
      },
    };
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "Timed out while fetching that link."
        : err instanceof Error
          ? err.message
          : "Could not fetch that link.";
    return {
      executed: false,
      error: message,
      output: { url },
    };
  }
}
