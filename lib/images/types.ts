export const IMAGE_STYLES = [
  { id: "photorealistic", label: "Photorealistic" },
  { id: "cinematic", label: "Cinematic" },
  { id: "editorial", label: "Editorial" },
  { id: "product", label: "Product photography" },
  { id: "architecture", label: "Architecture" },
  { id: "interior", label: "Interior design" },
  { id: "landscape", label: "Landscape" },
  { id: "illustration", label: "Illustration" },
  { id: "fantasy", label: "Fantasy art" },
] as const;

export type ImageStyleId = (typeof IMAGE_STYLES)[number]["id"];

export const ASPECT_RATIOS = [
  { id: "16:9", label: "Landscape 16:9", gemini: "16:9" },
  { id: "3:2", label: "Photo 3:2", gemini: "3:2" },
  { id: "4:3", label: "Classic 4:3", gemini: "4:3" },
  { id: "1:1", label: "Square 1:1", gemini: "1:1" },
  { id: "4:5", label: "Portrait 4:5", gemini: "4:5" },
  { id: "9:16", label: "Story 9:16", gemini: "9:16" },
  { id: "21:9", label: "Cinematic 21:9", gemini: "21:9" },
] as const;

export type AspectRatioId = (typeof ASPECT_RATIOS)[number]["id"];

export const IMAGE_QUALITIES = [
  { id: "1K", label: "Standard" },
  { id: "2K", label: "High" },
] as const;

export type ImageQualityId = (typeof IMAGE_QUALITIES)[number]["id"];

export interface ImageGenOptions {
  style: ImageStyleId;
  aspectRatio: AspectRatioId;
  quality: ImageQualityId;
  count: 1 | 2;
  variation?: boolean;
  extraPrompt?: string;
}

export const DEFAULT_IMAGE_GEN: ImageGenOptions = {
  style: "photorealistic",
  aspectRatio: "16:9",
  quality: "2K",
  count: 1,
};

export function parseImageStyle(value: string | undefined): ImageStyleId {
  return IMAGE_STYLES.some((item) => item.id === value)
    ? (value as ImageStyleId)
    : DEFAULT_IMAGE_GEN.style;
}

export function parseAspectRatio(value: string | undefined): AspectRatioId {
  return ASPECT_RATIOS.some((item) => item.id === value)
    ? (value as AspectRatioId)
    : DEFAULT_IMAGE_GEN.aspectRatio;
}

export function parseImageQuality(value: string | undefined): ImageQualityId {
  return IMAGE_QUALITIES.some((item) => item.id === value)
    ? (value as ImageQualityId)
    : DEFAULT_IMAGE_GEN.quality;
}

export function parseVariationCount(value: string | number | undefined): 1 | 2 {
  return Number(value) === 2 ? 2 : 1;
}

export function parseImageGenOptions(
  input: Record<string, string> | undefined
): ImageGenOptions {
  return {
    style: parseImageStyle(input?.image_style),
    aspectRatio: parseAspectRatio(input?.aspect_ratio),
    quality: parseImageQuality(input?.image_quality),
    count: parseVariationCount(input?.variation_count),
  };
}
