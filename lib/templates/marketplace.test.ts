import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MARKETPLACE_TEMPLATES } from "./marketplace-catalog";
import { countTemplatesByCategory, filterTemplates } from "./categories";
import { safetyDefaultsForRisk } from "./safety-defaults";
import { buildSafetySettingsFromTemplate, resolveAutoAllow, shouldStartPaused } from "./clone-safety";
import {
  assertTemplateAgentCanActivate,
  markTemplatePermissionsReviewed,
  TemplateActivationError,
} from "./activation";
import { toTemplateRow } from "./seed-rows";
import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";

describe("marketplace catalog", () => {
  it("seeds published templates with unique slugs including Lighting Concierge", () => {
    assert.equal(MARKETPLACE_TEMPLATES.length, 54);
    const slugs = MARKETPLACE_TEMPLATES.map((template) => template.slug ?? template.id);
    assert.equal(new Set(slugs).size, 54);
    assert.ok(MARKETPLACE_TEMPLATES.some((template) => template.slug === "lighting-concierge"));
    assert.ok(MARKETPLACE_TEMPLATES.some((template) => template.slug === "travel-companion"));
    assert.ok(MARKETPLACE_TEMPLATES.some((template) => template.slug === "wedding-celebration-planner"));
    assert.ok(MARKETPLACE_TEMPLATES.some((template) => template.slug === "group-decision-planner"));
    assert.ok(MARKETPLACE_TEMPLATES.every((template) => template.isPublished !== false));
    assert.equal(
      MARKETPLACE_TEMPLATES.find((template) => template.slug === "lighting-concierge")?.category,
      "home-services"
    );
    const lighting = MARKETPLACE_TEMPLATES.find((template) => template.slug === "lighting-concierge");
    assert.ok(lighting);
    assert.equal(lighting.tools.includes("send_email"), false);
    assert.ok(lighting.suggestedIntegrations?.includes("Wave notify"));
    const lightingSafety = buildSafetySettingsFromTemplate(lighting, { needsApproval: false });
    assert.ok(lightingSafety.mission?.allowedTools?.includes("create_service_quote"));
    assert.equal(lightingSafety.thresholdInr, 5000);
    const travel = MARKETPLACE_TEMPLATES.find((template) => template.slug === "travel-companion");
    assert.ok(travel);
    assert.equal(travel.category, "travel-lifestyle");
    const travelSafety = buildSafetySettingsFromTemplate(travel, { needsApproval: false });
    assert.ok(travelSafety.mission?.allowedTools?.includes("plan_travel_itinerary"));
    assert.equal(travelSafety.thresholdInr, 5000);
    const wedding = MARKETPLACE_TEMPLATES.find((template) => template.slug === "wedding-celebration-planner");
    assert.ok(wedding);
    assert.equal(wedding.category, "events-planning");
    assert.equal(wedding.tools.includes("send_email"), false);
    const weddingSafety = buildSafetySettingsFromTemplate(wedding, { needsApproval: false });
    assert.ok(weddingSafety.mission?.allowedTools?.includes("plan_wedding_event"));
    assert.equal(weddingSafety.thresholdInr, 10000);
    assert.equal(weddingSafety.weddingPlanner?.depositThresholdInr, 10000);
    const group = MARKETPLACE_TEMPLATES.find((template) => template.slug === "group-decision-planner");
    assert.ok(group);
    assert.equal(group.category, "travel-lifestyle");
    const groupSafety = buildSafetySettingsFromTemplate(group, { needsApproval: false });
    assert.ok(groupSafety.mission?.allowedTools?.includes("plan_group_outing"));
    assert.equal(groupSafety.thresholdInr, 5000);
  });

  it("upsert rows are idempotent by id/slug", () => {
    const first = MARKETPLACE_TEMPLATES.map(toTemplateRow);
    const second = MARKETPLACE_TEMPLATES.map(toTemplateRow);
    assert.deepEqual(
      first.map((row) => row.id),
      second.map((row) => row.id)
    );
    assert.equal(first[0]?.id, first[0]?.slug);
  });
});

describe("filterTemplates", () => {
  it("filters by category, risk, approval, tool, and search", () => {
    const high = filterTemplates(MARKETPLACE_TEMPLATES, { riskLevel: "high" });
    assert.ok(high.length > 0);
    assert.ok(high.every((template) => template.riskLevel === "high"));

    const sales = filterTemplates(MARKETPLACE_TEMPLATES, { category: "sales-marketing" });
    assert.equal(countTemplatesByCategory(MARKETPLACE_TEMPLATES)["sales-marketing"], sales.length);

    const refunds = filterTemplates(MARKETPLACE_TEMPLATES, { search: "refund" });
    assert.ok(refunds.some((template) => template.slug === "refund-request-assistant"));

    const emailTool = filterTemplates(MARKETPLACE_TEMPLATES, { tool: "email" });
    assert.ok(emailTool.length > 0);

    const approval = filterTemplates(MARKETPLACE_TEMPLATES, { requiresApproval: true });
    assert.ok(approval.every((template) => template.requiresApproval === true));
  });
});

describe("safety defaults and clone", () => {
  it("enforces high-risk defaults server-side", () => {
    const high = MARKETPLACE_TEMPLATES.find((template) => template.slug === "cold-email-drafter");
    assert.ok(high);
    const defaults = safetyDefaultsForRisk("high", high.tools);
    assert.equal(defaults.startPaused, true);
    assert.equal(defaults.autoAllow, false);
    assert.ok(defaults.requireApprovalFor.includes("send_email"));

    const customizations = { needsApproval: false };
    assert.equal(resolveAutoAllow(high, customizations), false);
    assert.equal(shouldStartPaused(high), true);

    const safety = buildSafetySettingsFromTemplate(high, customizations);
    assert.equal(safety.template?.riskLevel, "high");
    assert.equal(safety.template?.permissionsReviewedAt, null);
    assert.ok((safety.requireApprovalFor ?? []).length > 0);
  });

  it("keeps low-risk templates read/draft oriented", () => {
    const low = MARKETPLACE_TEMPLATES.find((template) => template.slug === "lead-researcher");
    assert.ok(low);
    const defaults = safetyDefaultsForRisk("low", low.tools);
    assert.equal(defaults.startPaused, false);
    assert.ok(defaults.toolPermissions.every((item) => item.permission !== "allow"));
  });
});

describe("high-risk activation", () => {
  function agent(reviewed: boolean): Pick<BuilderAgentRecord, "safetySettings" | "name"> {
    return {
      name: "Cold Email Drafter Agent",
      safetySettings: {
        template: {
          id: "cold-email-drafter",
          name: "Cold Email Drafter",
          riskLevel: "high",
          permissionsReviewedAt: reviewed ? new Date().toISOString() : null,
        },
      },
    };
  }

  it("blocks high-risk template activation until permissions are reviewed", () => {
    assert.throws(
      () => assertTemplateAgentCanActivate(agent(false)),
      TemplateActivationError
    );
  });

  it("allows high-risk activation after review and never gates non-template agents", () => {
    assert.doesNotThrow(() => assertTemplateAgentCanActivate(agent(true)));
    assert.doesNotThrow(() =>
      assertTemplateAgentCanActivate({
        name: "Builder agent",
        safetySettings: {},
      })
    );
    const marked = markTemplatePermissionsReviewed(agent(false).safetySettings);
    assert.ok(marked.template?.permissionsReviewedAt);
  });
});
