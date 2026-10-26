export type ImageGenFailureKind =
  | "missing_config"
  | "invalid_api_key"
  | "billing"
  | "quota"
  | "rate_limit"
  | "unsupported_model"
  | "timeout"
  | "provider";

export interface GeminiErrorPayload {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{
      "@type"?: string;
      reason?: string;
      domain?: string;
      violations?: Array<{
        quotaMetric?: string;
        quotaId?: string;
        quotaValue?: string;
        quotaDimensions?: { model?: string; location?: string };
      }>;
    }>;
  };
}

export class GeminiImageError extends Error {
  readonly kind: ImageGenFailureKind;
  readonly httpStatus?: number;
  readonly providerStatus?: string;
  readonly providerCode?: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly model?: string;
  readonly quotaMetric?: string;
  readonly quotaId?: string;

  constructor(params: {
    kind: ImageGenFailureKind;
    message: string;
    httpStatus?: number;
    providerStatus?: string;
    providerCode?: number;
    retryable: boolean;
    retryAfterMs?: number;
    model?: string;
    quotaMetric?: string;
    quotaId?: string;
  }) {
    super(params.message);
    this.name = "GeminiImageError";
    this.kind = params.kind;
    this.httpStatus = params.httpStatus;
    this.providerStatus = params.providerStatus;
    this.providerCode = params.providerCode;
    this.retryable = params.retryable;
    this.retryAfterMs = params.retryAfterMs;
    this.model = params.model;
    this.quotaMetric = params.quotaMetric;
    this.quotaId = params.quotaId;
  }
}

function firstViolation(payload: GeminiErrorPayload | undefined) {
  const details = payload?.error?.details ?? [];
  for (const detail of details) {
    const violation = detail.violations?.[0];
    if (violation) return violation;
  }
  return undefined;
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header?.trim()) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(8_000, Math.max(250, Math.round(seconds * 1000)));
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.min(8_000, Math.max(250, date - Date.now()));
  }
  return undefined;
}

export function classifyGeminiImageError(params: {
  httpStatus: number;
  payload?: GeminiErrorPayload;
  retryAfter?: string | null;
  model?: string;
  rawMessage?: string;
}): GeminiImageError {
  const message = (params.payload?.error?.message || params.rawMessage || "").trim();
  const lower = message.toLowerCase();
  const providerStatus = params.payload?.error?.status;
  const providerCode = params.payload?.error?.code ?? params.httpStatus;
  const violation = firstViolation(params.payload);
  const quotaMetric = violation?.quotaMetric ?? "";
  const quotaId = violation?.quotaId ?? "";
  const quotaValue = violation?.quotaValue ?? "";
  const retryAfterMs = parseRetryAfterMs(params.retryAfter ?? null);
  const freeTier =
    /free_tier|freetier|free-tier/i.test(`${quotaMetric} ${quotaId} ${message}`) ||
    (/\blimit:\s*0\b/i.test(message) && /quota/i.test(message));
  const billing =
    params.httpStatus === 402 ||
    providerStatus === "FAILED_PRECONDITION" ||
    /enable billing|paid plan|prepay|billing details|free tier is not available/i.test(message);

  if (params.httpStatus === 401 || /api.?key.*(invalid|not valid|expired)/i.test(message)) {
    return new GeminiImageError({
      kind: "invalid_api_key",
      message:
        "Gemini rejected this API key. Put a Google AI Studio key in GEMINI_API_KEY in .env.local, then restart npm run dev.",
      httpStatus: params.httpStatus,
      providerStatus,
      providerCode,
      retryable: false,
      model: params.model,
    });
  }

  if (params.httpStatus === 403 || providerStatus === "PERMISSION_DENIED") {
    return new GeminiImageError({
      kind: billing ? "billing" : "invalid_api_key",
      message: billing
        ? "Gemini image generation is blocked until billing is enabled for this Google AI Studio project. WAVE cannot turn billing on for you."
        : "Gemini denied this API key for image generation. Check GEMINI_API_KEY and model access in Google AI Studio.",
      httpStatus: params.httpStatus,
      providerStatus,
      providerCode,
      retryable: false,
      model: params.model,
    });
  }

  if (params.httpStatus === 404 || providerStatus === "NOT_FOUND" || /not found|not supported|invalid model/i.test(message)) {
    return new GeminiImageError({
      kind: "unsupported_model",
      message: `The configured image model is not available on this key. Set GEMINI_IMAGE_MODEL to an image model such as gemini-3.1-flash-image. Current: ${params.model ?? "unset"}.`,
      httpStatus: params.httpStatus,
      providerStatus,
      providerCode,
      retryable: false,
      model: params.model,
    });
  }

  if (params.httpStatus === 400 && billing) {
    return new GeminiImageError({
      kind: "billing",
      message:
        "Gemini image models are not available on the free tier in this region. Enable billing in Google AI Studio, then retry. WAVE will not enable billing automatically.",
      httpStatus: params.httpStatus,
      providerStatus,
      providerCode,
      retryable: false,
      model: params.model,
    });
  }

  if (params.httpStatus === 402 || (billing && params.httpStatus !== 429)) {
    return new GeminiImageError({
      kind: "billing",
      message:
        "Gemini image generation requires an active Google AI Studio billing plan or credits. Check the plan at https://aistudio.google.com/. WAVE will not enable billing automatically.",
      httpStatus: params.httpStatus,
      providerStatus,
      providerCode,
      retryable: false,
      model: params.model,
    });
  }

  if (params.httpStatus === 429 || providerStatus === "RESOURCE_EXHAUSTED") {
    if (freeTier || quotaValue === "0") {
      return new GeminiImageError({
        kind: "quota",
        message:
          "Gemini image generation has no free-tier quota on this project (limit 0). Enable billing for the Google AI Studio project, then generate again. Waiting will not restore a zero free-tier limit. WAVE will not enable billing automatically.",
        httpStatus: params.httpStatus,
        providerStatus,
        providerCode,
        retryable: false,
        model: params.model || violation?.quotaDimensions?.model,
        quotaMetric,
        quotaId,
      });
    }
    return new GeminiImageError({
      kind: "rate_limit",
      message:
        "Gemini is rate-limiting image generation right now. Wait a few seconds and use Retry. If this keeps happening, check usage at https://ai.dev/rate-limit.",
      httpStatus: params.httpStatus,
      providerStatus,
      providerCode,
      retryable: true,
      retryAfterMs,
      model: params.model || violation?.quotaDimensions?.model,
      quotaMetric,
      quotaId,
    });
  }

  if (params.httpStatus === 503 || params.httpStatus === 500) {
    return new GeminiImageError({
      kind: "provider",
      message: "Gemini is temporarily unavailable. Wait a moment and use Retry.",
      httpStatus: params.httpStatus,
      providerStatus,
      providerCode,
      retryable: true,
      retryAfterMs,
      model: params.model,
    });
  }

  if (/timeout|aborted|deadline/i.test(lower)) {
    return new GeminiImageError({
      kind: "timeout",
      message: "Image generation timed out. Try Standard quality or one image.",
      httpStatus: params.httpStatus,
      providerStatus,
      providerCode,
      retryable: true,
      model: params.model,
    });
  }

  return new GeminiImageError({
    kind: "provider",
    message: message
      ? message.length > 280
        ? `${message.slice(0, 280)}…`
        : message
      : "Gemini image generation failed.",
    httpStatus: params.httpStatus,
    providerStatus,
    providerCode,
    retryable: false,
    model: params.model,
    quotaMetric,
    quotaId,
  });
}

export function imageGenerationUserMessage(err: unknown): string {
  if (err instanceof GeminiImageError) return err.message;
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes("gemini_api_key is not configured") || lower.includes("not configured")) {
    return "Add GEMINI_API_KEY to .env.local to generate images with Gemini. WAVE does not invent image URLs.";
  }
  return classifyGeminiImageError({
    httpStatus: 0,
    rawMessage: raw,
  }).message;
}

export function logGeminiImageFailure(error: GeminiImageError): void {
  console.warn("[images] gemini generate failed", {
    httpStatus: error.httpStatus ?? null,
    providerStatus: error.providerStatus ?? null,
    providerCode: error.providerCode ?? null,
    kind: error.kind,
    model: error.model ?? null,
    quotaMetric: error.quotaMetric ?? null,
    quotaId: error.quotaId ?? null,
    retryable: error.retryable,
  });
}
