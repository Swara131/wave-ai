import type { AspectRatioId, ImageGenOptions, ImageStyleId } from "./types";

const STYLE_DIRECTION: Record<ImageStyleId, string> = {
  photorealistic:
    "photorealistic photography, natural color science, true-to-life materials, no illustration look",
  cinematic:
    "cinematic still, anamorphic depth, filmic contrast, motivated practical lighting, shallow depth of field where it serves the scene",
  editorial:
    "editorial photography, magazine-cover clarity, refined styling, precise styling, clean negative space",
  product:
    "product photography, studio-grade sharpness, controlled highlights, tactile material detail",
  architecture:
    "architectural photography, correct perspective, crisp edges, accurate structure, natural daylight",
  interior:
    "interior design photography, lived-in spatial depth, honest materials, balanced ambient light",
  landscape:
    "landscape photography, wide environmental clarity, natural atmosphere, real weather and light",
  illustration:
    "polished illustration, coherent line and color, intentional stylization, no photo-filter artifacts",
  fantasy:
    "cinematic fantasy art, believable lighting on imagined elements, rich but controlled palette",
};

export function buildDirectorImagePrompt(params: {
  scene: string;
  title?: string;
  notes?: string;
  options: ImageGenOptions;
}): string {
  const style = STYLE_DIRECTION[params.options.style];
  const avoid = [
    "blur",
    "haze",
    "low resolution",
    "watermarks",
    "logos",
    "price tags",
    "captions",
    "text overlays",
    "distorted faces or furniture",
    "repeated objects",
    "oversaturated HDR",
    "changing the real location into a different place",
  ].join(", ");

  return [
    params.title ? `Title: ${params.title}.` : "",
    "Main subject and scene:",
    params.scene.trim().slice(0, 1200),
    params.notes?.trim() ? `Operator notes (do not override the photo): ${params.notes.trim()}` : "",
    "Composition and camera: keep the uploaded photo's viewpoint, horizon, and proportions. Full-frame, balanced composition, correct perspective.",
    `Lighting, color, atmosphere: match the real scene. Style: ${style}.`,
    "Textures and detail: sharp fabrics, wood, stone, water, foliage, and sky as they appear in the reference. Natural grain, no plastic skin or melted edges.",
    `Aspect ratio ${params.options.aspectRatio}. Quality ${params.options.quality}, high detail, print-ready clarity.`,
    params.options.variation
      ? "Create a distinct variation of the same place: change seating or lighting slightly, keep architecture and landscape identical."
      : "Produce one hero image of this exact place.",
    `Avoid: ${avoid}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function aspectRatioForGemini(ratio: AspectRatioId): string {
  return ratio;
}
