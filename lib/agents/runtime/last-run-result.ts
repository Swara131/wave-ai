import type { ConceptImage } from "./concept-image";

const PREFIX = "wave:last-run-result:";

export interface LastRunResult {
  agentId: string;
  agentName: string;
  sourceUrl?: string;
  focus?: string;
  summary: string;
  createdAt: string;
  photoPreview?: string;
  photoName?: string;
  kind?: "summary" | "photo";
  conceptImages?: ConceptImage[];
  generationError?: string;
  generationProvider?: string;
  generationModel?: string;
  generationErrorKind?: string;
  generationRetryable?: boolean;
  imageStyle?: string;
  aspectRatio?: string;
  imageQuality?: string;
  imagePrompt?: string;
}

function storageKey(agentId: string): string {
  return `${PREFIX}${agentId}`;
}

export function saveLastRunResult(result: LastRunResult): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(result.agentId), JSON.stringify(result));
  } catch {
    try {
      const { conceptImages: _images, ...rest } = result;
      window.sessionStorage.setItem(storageKey(result.agentId), JSON.stringify(rest));
    } catch {
      /* quota */
    }
  }
}

export function loadLastRunResult(agentId: string): LastRunResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(agentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastRunResult;
    if (parsed.agentId !== agentId || !parsed.summary?.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}
