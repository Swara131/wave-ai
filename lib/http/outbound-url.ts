const PRIVATE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

export function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (PRIVATE_HOSTS.has(lower) || lower.endsWith(".local")) return true;
  if (lower.startsWith("10.") || lower.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)) return true;
  return false;
}

export function parsePublicHttpUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "A URL is required." };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "That is not a valid URL." };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: "Only http and https URLs are allowed." };
  }

  if (isBlockedHost(parsed.hostname)) {
    return { ok: false, error: "Requests to internal or local addresses are not allowed." };
  }

  return { ok: true, url: parsed };
}

export function extractHttpUrl(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const match = text.match(/https?:\/\/[^\s<>"')\]]+/i);
  if (!match) return null;
  const cleaned = match[0].replace(/[.,;:]+$/, "");
  const parsed = parsePublicHttpUrl(cleaned);
  return parsed.ok ? parsed.url.toString() : null;
}

export function youtubeVideoId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const v = url.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const parts = url.pathname.split("/").filter(Boolean);
    if ((parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") && parts[1] && /^[\w-]{11}$/.test(parts[1])) {
      return parts[1];
    }
  }
  return null;
}
