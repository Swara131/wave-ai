import type { AgentSafetySettings } from "@/lib/agents/runtime-types";
import { LIGHTING_TEMPLATE_SLUG } from "@/lib/lighting-concierge/constants";
import { defaultLightingRates } from "@/lib/lighting-concierge/pricing";
import { LIGHTING_MISSION } from "@/lib/lighting-concierge/workflow";
import { TRAVEL_MISSION, TRAVEL_TEMPLATE_SLUG } from "@/lib/travel-companion/constants";
import { WEDDING_MISSION, WEDDING_TEMPLATE_SLUG } from "@/lib/wedding-planner/constants";
import { GROUP_MISSION, GROUP_TEMPLATE_SLUG } from "@/lib/group-planner/constants";
import type { AgentTemplate, TemplateCustomizations } from "./types";
import { safetyDefaultsForRisk } from "./safety-defaults";

export function buildSafetySettingsFromTemplate(
  template: AgentTemplate,
  customizations: TemplateCustomizations
): AgentSafetySettings {
  const risk = template.riskLevel ?? "medium";
  const defaults = safetyDefaultsForRisk(risk, template.tools);
  const needsApproval =
    customizations.needsApproval || defaults.requiresApproval || risk === "high";

  return {
    template: {
      id: template.id,
      name: template.name,
      slug: template.slug ?? template.id,
      riskLevel: risk,
      permissionsReviewedAt: null,
    },
    requireApprovalFor: needsApproval ? defaults.requireApprovalFor : [],
    maxToolCallsPerRun: defaults.executionLimits.maxToolCallsPerRun,
    maxRunDurationMs: defaults.executionLimits.maxRunDurationMs,
    thresholdInr: template.supportsThreshold
      ? customizations.threshold ?? template.defaultThreshold ?? 5000
      : undefined,
    autoAllowBelowThreshold: !needsApproval && risk === "low",
    delivery: {
      mode: "notification",
      destinationEmail: null,
      destinationPhone: null,
    },
    requirementChoices: { output: "notification" },
    ...(template.slug === LIGHTING_TEMPLATE_SLUG || template.id === LIGHTING_TEMPLATE_SLUG
      ? {
          lightingConcierge: { rates: defaultLightingRates() },
          mission: { ...LIGHTING_MISSION },
          thresholdInr: customizations.threshold ?? template.defaultThreshold ?? 5000,
        }
      : {}),
    ...(template.slug === TRAVEL_TEMPLATE_SLUG || template.id === TRAVEL_TEMPLATE_SLUG
      ? {
          travelCompanion: { bookingThresholdInr: customizations.threshold ?? template.defaultThreshold ?? 5000 },
          mission: { ...TRAVEL_MISSION },
          thresholdInr: customizations.threshold ?? template.defaultThreshold ?? 5000,
        }
      : {}),
    ...(template.slug === WEDDING_TEMPLATE_SLUG || template.id === WEDDING_TEMPLATE_SLUG
      ? {
          weddingPlanner: { depositThresholdInr: customizations.threshold ?? template.defaultThreshold ?? 10000 },
          mission: { ...WEDDING_MISSION },
          thresholdInr: customizations.threshold ?? template.defaultThreshold ?? 10000,
        }
      : {}),
    ...(template.slug === GROUP_TEMPLATE_SLUG || template.id === GROUP_TEMPLATE_SLUG
      ? {
          groupPlanner: { reservationThresholdInr: customizations.threshold ?? template.defaultThreshold ?? 5000 },
          mission: { ...GROUP_MISSION },
          thresholdInr: customizations.threshold ?? template.defaultThreshold ?? 5000,
        }
      : {}),
  };
}

export function resolveAutoAllow(
  template: AgentTemplate,
  customizations: TemplateCustomizations
): boolean {
  const risk = template.riskLevel ?? "medium";
  const defaults = safetyDefaultsForRisk(risk, template.tools);
  if (risk === "high") return false;
  if (defaults.requiresApproval || customizations.needsApproval) return false;
  return true;
}

export function shouldStartPaused(template: AgentTemplate): boolean {
  const risk = template.riskLevel ?? "medium";
  return safetyDefaultsForRisk(risk, template.tools).startPaused;
}
