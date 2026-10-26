import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPublicGalleryTemplates } from "./public-gallery";
import { PreviewValidationError, runGuestTemplatePreview } from "./guest-preview";

describe("public gallery", () => {
  it("lists the four ready-made templates", () => {
    const slugs = getPublicGalleryTemplates().map((item) => item.slug);
    assert.deepEqual(slugs, [
      "lighting-concierge",
      "travel-companion",
      "wedding-celebration-planner",
      "group-decision-planner",
    ]);
  });
});

describe("runGuestTemplatePreview", () => {
  it("rejects unknown templates", async () => {
    await assert.rejects(
      () => runGuestTemplatePreview("unknown", {}),
      PreviewValidationError
    );
  });

  it("rejects invalid lighting intake", async () => {
    await assert.rejects(
      () => runGuestTemplatePreview("lighting-concierge", { customerName: "A" }),
      PreviewValidationError
    );
  });

  it("builds a wedding preview without Qloo and without persisting", async () => {
    const result = await runGuestTemplatePreview("wedding-celebration-planner", {
      eventName: "Mehra garden wedding",
      eventType: "wedding",
      startDate: "2026-12-12",
      location: "Jaipur",
      guestCount: 180,
      budgetAmount: 850000,
      budgetCurrency: "INR",
      couplePreferences: "Garden venue, vegetarian thali, indie live music",
      venueStyle: "garden",
    });
    assert.equal(result.preview, true);
    assert.equal(result.persisted, false);
    assert.equal(result.slug, "wedding-celebration-planner");
    assert.ok(result.sources.includes("stated_preferences"));
    assert.ok(result.warnings.some((item) => /does not use Qloo/i.test(item)));
    assert.ok(result.warnings.some((item) => /not saved/i.test(item)));
  });
});
