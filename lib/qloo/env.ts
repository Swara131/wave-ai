function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getQlooApiKey(): string | null {
  return readEnv("QLOO_API_KEY");
}

export function isQlooConfigured(): boolean {
  return Boolean(getQlooApiKey());
}

/** Production Insights API host from Qloo docs. Override for staging. */
export function getQlooApiBaseUrl(): string {
  const configured = readEnv("QLOO_API_BASE_URL");
  if (configured) return configured.replace(/\/+$/, "");
  return "https://api.qloo.com";
}
