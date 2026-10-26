import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDirectorImagePrompt } from "./director-prompt";
import { DEFAULT_IMAGE_GEN, parseImageGenOptions } from "./types";

describe("image prompt builder", () => {
  it("keeps the scene and adds camera, lighting, and avoid lists", () => {
    const prompt = buildDirectorImagePrompt({
      scene: "A wide open beach with turquoise water and tan sand.",
      title: "Ceremony seating",
      notes: "Keep the ocean in the background.",
      options: DEFAULT_IMAGE_GEN,
    });
    assert.match(prompt, /wide open beach/);
    assert.match(prompt, /Keep the ocean/);
    assert.match(prompt, /Composition and camera/);
    assert.match(prompt, /16:9/);
    assert.match(prompt, /Avoid:.*watermarks/);
    assert.doesNotMatch(prompt, /mountain lodge|ballroom chandelier/i);
  });

  it("parses generation controls with safe defaults", () => {
    const parsed = parseImageGenOptions({
      image_style: "cinematic",
      aspect_ratio: "9:16",
      image_quality: "1K",
      variation_count: "2",
    });
    assert.equal(parsed.style, "cinematic");
    assert.equal(parsed.aspectRatio, "9:16");
    assert.equal(parsed.quality, "1K");
    assert.equal(parsed.count, 2);
    assert.equal(parseImageGenOptions({ image_style: "not-real" }).style, "photorealistic");
  });
});
