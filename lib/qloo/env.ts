function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/** Hackathon Insights host. Hackathon keys 401 on api.qloo.com. */
export const QLOO_HACKATHON_API_BASE_URL = "https://hackathon.api.qloo.com";

export function getQlooApiKey(): string | null {
  return readEnv("QLOO_API_KEY");
}

export function isQlooConfigured(): boolean {
  return Boolean(getQlooApiKey());
}

export function normalizeQlooBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isCommercialQlooHost(baseUrl: string): boolean {
  const host = normalizeQlooBaseUrl(baseUrl).toLowerCase();
  return host === "https://api.qloo.com" || host === "https://staging.api.qloo.com";
}

/**
 * Hackathon keys only authenticate against hackathon.api.qloo.com.
 * Default there. If QLOO_API_BASE_URL points at commercial Qloo, still
 * prefer the hackathon host unless QLOO_API_USE_COMMERCIAL=true.
 */
export function getQlooApiBaseUrl(): string {
  const configured = readEnv("QLOO_API_BASE_URL");
  if (!configured) return QLOO_HACKATHON_API_BASE_URL;
  const normalized = normalizeQlooBaseUrl(configured);
  const useCommercial = readEnv("QLOO_API_USE_COMMERCIAL")?.toLowerCase() === "true";
  if (!useCommercial && isCommercialQlooHost(normalized)) {
    return QLOO_HACKATHON_API_BASE_URL;
  }
  return normalized;
}

export function shouldRetryQlooOnHackathon(baseUrl: string): boolean {
  return normalizeQlooBaseUrl(baseUrl) !== QLOO_HACKATHON_API_BASE_URL;
}

export function unauthorizedQlooMessage(status: number): string {
  return `Qloo returned HTTP ${status}. Hackathon API keys only work at ${QLOO_HACKATHON_API_BASE_URL}. Set QLOO_API_BASE_URL to that host (do not use api.qloo.com).`;
}
