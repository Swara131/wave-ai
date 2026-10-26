export function isGeminiConfigured(): boolean {
  return Boolean(readGeminiApiKey());
}

function cleanEnvValue(value: string | undefined): string {
  return value?.trim().replace(/^['"]|['"]$/g, "").trim() ?? "";
}

function readGeminiApiKey(): string {
  return (
    cleanEnvValue(process.env.GEMINI_API_KEY) ||
    cleanEnvValue(process.env.GOOGLE_GENERATIVE_AI_API_KEY) ||
    cleanEnvValue(process.env.GOOGLE_API_KEY)
  );
}

export function getGeminiApiKey(): string {
  const key = readGeminiApiKey();
  if (!key) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }
  return key;
}

export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";
}

const KNOWN_IMAGE_MODELS = new Set([
  "gemini-nano-banana-2.1",
  "gemini-3.1-flash-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3.1-flash-lite-image",
  "gemini-3-pro-image",
  "gemini-3-pro-image-preview",
  "nano-banana-pro-preview",
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
]);

export function isGeminiImageModel(model: string): boolean {
  const id = model.trim();
  if (!id) return false;
  if (KNOWN_IMAGE_MODELS.has(id)) return true;
  return /image|banana|imagen/i.test(id);
}

/** Single configured Gemini image model. Does not fall back to text-only models. */
export function getGeminiImageModel(): string {
  const preferred = cleanEnvValue(process.env.GEMINI_IMAGE_MODEL);
  return preferred || "gemini-3.1-flash-image";
}

/** @deprecated Use getGeminiImageModel. Kept so existing imports still resolve. */
export function getGeminiImageModels(): string[] {
  return [getGeminiImageModel()];
}
