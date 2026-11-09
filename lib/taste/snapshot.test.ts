import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyTaste, mapStoredTaste } from "./snapshot";

describe("taste snapshot", () => {
  it("maps a stored web-search payload", () => {
    const taste = mapStoredTaste({
      source: "web_search",
      queriedAt: "2026-01-01T00:00:00.000Z",
      usedSignals: ["Jaipur"],
      places: [{ name: "Hawa Mahal", url: "https://example.com" }],
    });
    assert.equal(taste.source, "web_search");
    assert.equal(taste.places[0]?.name, "Hawa Mahal");
  });

  it("treats a legacy Qloo payload as stated preferences without calling an API", () => {
    const taste = mapStoredTaste({
      source: "qloo",
      queriedAt: "2026-01-01T00:00:00.000Z",
      entities: [{ name: "Old Place", entityId: "x" }],
      tags: [{ name: "Folk", tagId: "t" }],
    });
    assert.equal(taste.source, "stated_preferences");
    assert.equal(taste.places[0]?.name, "Old Place");
  });

  it("returns an empty stated-preference snapshot", () => {
    const taste = emptyTaste(["food"]);
    assert.equal(taste.source, "stated_preferences");
    assert.deepEqual(taste.usedSignals, ["food"]);
    assert.equal(taste.places.length, 0);
  });
});
