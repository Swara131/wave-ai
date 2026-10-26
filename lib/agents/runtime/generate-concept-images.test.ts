import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("generateConceptImages", () => {
  it("does not use Pollinations or fabricated image URLs", () => {
    const source = readFileSync(new URL("./generate-concept-images.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /pollinations/i);
    assert.doesNotMatch(source, /image\.pollinations/);
  });
});
