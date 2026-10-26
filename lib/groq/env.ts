function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing environment variable: ${name}. Add it to .env.local (see .env.example).`
    );
  }
  return value;
}

export function isGroqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

export function getGroqApiKey(): string {
  return requireEnv("GROQ_API_KEY");
}

/** Default model — override with GROQ_MODEL in .env.local if needed. */
export function getGroqModel(): string {
  return process.env.GROQ_MODEL?.trim() ?? "openai/gpt-oss-120b";
}

/** Vision model used when a photo is uploaded for an agent run. */
export function getGroqVisionModel(): string {
  return getGroqVisionModels()[0]!;
}

export function getGroqVisionModels(): string[] {
  const preferred = process.env.GROQ_VISION_MODEL?.trim();
  const models = [
    preferred,
    "qwen/qwen3.8-27b",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
  ].filter((item): item is string => Boolean(item));
  return [...new Set(models)];
}
