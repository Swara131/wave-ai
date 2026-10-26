export const SOURCE_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const SOURCE_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export interface SourceImage {
  mimeType: string;
  base64: string;
  filename: string;
}

export function isAllowedSourceImage(file: File): boolean {
  if (file.size <= 0 || file.size > SOURCE_IMAGE_MAX_BYTES) return false;
  return SOURCE_IMAGE_MIME.has(file.type) || /\.(jpe?g|png|webp|gif)$/i.test(file.name);
}

export function sourceImageFromFile(file: File, bytes: Buffer): SourceImage {
  const mimeType = SOURCE_IMAGE_MIME.has(file.type) ? file.type : "image/jpeg";
  return {
    mimeType,
    base64: bytes.toString("base64"),
    filename: file.name.slice(0, 180),
  };
}

export function sourceImageFromDataUrl(
  dataUrl: string,
  filename = "reference.jpg"
): SourceImage {
  const match = dataUrl.trim().match(/^data:([^;]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    throw new Error("The reference photo is not a valid image.");
  }
  const mimeType = match[1].trim();
  const base64 = match[2].replace(/\s/g, "");
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes <= 0 || bytes > SOURCE_IMAGE_MAX_BYTES) {
    throw new Error("Photo must be 4 MB or smaller.");
  }
  if (!SOURCE_IMAGE_MIME.has(mimeType)) {
    throw new Error("Upload a JPEG, PNG, WebP, or GIF photo.");
  }
  return { mimeType, base64, filename: filename.slice(0, 180) };
}
