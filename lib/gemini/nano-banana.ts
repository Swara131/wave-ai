import type { ConceptPrompt } from "@/lib/agents/runtime/concept-image";
import type { SourceImage } from "@/lib/agents/runtime/source-image";
import { generateGeminiConceptImages } from "@/lib/images/gemini-image";
import type { ImageGenOptions } from "@/lib/images/types";

/** Gemini Flash Image (Nano Banana) — photorealistic concept renders from a reference photo. */
export async function generateNanoBananaConcepts(params: {
  image: SourceImage;
  concepts: ConceptPrompt[];
  options?: ImageGenOptions;
  scene?: string;
  notes?: string;
}) {
  return generateGeminiConceptImages(params);
}
