import type { ConceptPrompt } from "./concept-image";
import type { SourceImage } from "./source-image";
import {
  generateGeminiConceptImages,
  type GeneratedImageBatch,
} from "@/lib/images/gemini-image";
import type { ImageGenOptions } from "@/lib/images/types";

export type { GeneratedImageBatch };

export async function generateConceptImages(params: {
  image: SourceImage;
  concepts: ConceptPrompt[];
  options?: ImageGenOptions;
  scene?: string;
  notes?: string;
}): Promise<GeneratedImageBatch> {
  return generateGeminiConceptImages(params);
}
