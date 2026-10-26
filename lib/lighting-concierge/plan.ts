import type { QlooTasteResult } from "@/lib/qloo/types";
import type { LightingPreference, StyleOption } from "./constants";
import type { LightingIntake, LightingPlan, LightingQuote } from "./types";

const KELVIN: Record<Exclude<LightingPreference, "unsure">, { range: string; explanation: string }> =
  {
    warm: {
      range: "2700K–3000K",
      explanation:
        "Warm white is a common choice for living rooms and bedrooms because it reads as relaxing. This is general lighting guidance, not a Qloo measurement.",
    },
    neutral: {
      range: "3500K–4000K",
      explanation:
        "Neutral white is often used in kitchens and bathrooms where tasks need clearer contrast. This is general lighting guidance, not a Qloo measurement.",
    },
    cool: {
      range: "4000K–5000K",
      explanation:
        "Cooler white can help with focused work in offices. Confirm glare and wall colour on site. This is general lighting guidance, not a Qloo measurement.",
    },
  };

function resolveKelvin(preference: LightingPreference, roomType: LightingIntake["roomType"]) {
  if (preference !== "unsure") return KELVIN[preference];
  if (roomType === "kitchen" || roomType === "bathroom" || roomType === "office") {
    return KELVIN.neutral;
  }
  return KELVIN.warm;
}

function styleCopy(style: StyleOption, qloo: QlooTasteResult): string {
  const base: Record<StyleOption, string> = {
    modern: "Clean lines, simple shades, and uncluttered ceiling fixtures.",
    minimalist: "Fewer fittings, hidden sources, and even ambient wash.",
    classic: "Layered lamps, warm metal finishes, and a central ceiling piece.",
    industrial: "Exposed fittings, metal pendants, and directional spots.",
    traditional: "Decorative shades, wall lights, and a warm central fixture.",
    unsure: "A flexible layered scheme that can take either modern or classic fittings.",
  };
  const qlooNames = qloo.tags.slice(0, 3).map((tag) => tag.name);
  if (qloo.source === "qloo" && qlooNames.length > 0) {
    return `${base[style]} Related décor tags from Qloo: ${qlooNames.join(", ")}. Qloo does not measure Kelvin or room suitability.`;
  }
  return `${base[style]} Style ranking used the customer's stated preference because Qloo taste data was not used.`;
}

export function buildLightingPlan(
  intake: LightingIntake,
  quote: LightingQuote,
  qloo: QlooTasteResult
): LightingPlan {
  const kelvin = resolveKelvin(intake.lightingPreference, intake.roomType);
  const questions = [
    "Confirm switching, dimmers, and existing circuit capacity with a qualified electrician.",
  ];
  if (!intake.roomDimensions) questions.push("Measure room length, width, and any alcoves.");
  if (!intake.ceilingHeight) questions.push("Confirm ceiling height before choosing pendants.");
  if (!intake.lightsNeeded) questions.push("Confirm how many fittings the customer actually wants.");

  let nextStep: LightingPlan["nextStep"] = "book_electrician_visit";
  if (intake.jobKind === "consultation" || !quote.complete) {
    nextStep = "request_consultation";
  }
  if (quote.totalInr > intake.budgetInr) {
    nextStep = "revise_plan";
    questions.push("The estimate is above the stated budget. Revise fittings or the rate table.");
  }

  return {
    styleAndAmbience: styleCopy(intake.preferredStyle, qloo),
    colourTemperatureKelvin: {
      range: kelvin.range,
      explanation: kelvin.explanation,
      source: "general_lighting_guidance",
    },
    layers: [
      {
        name: "Ambient",
        recommendation: "Provide even general light so the room is usable without dark corners.",
      },
      {
        name: "Task",
        recommendation:
          intake.roomType === "kitchen" || intake.roomType === "office"
            ? "Add targeted light over work surfaces. Do not wire this yourself."
            : "Add reading or vanity light where the customer actually works.",
      },
      {
        name: "Accent",
        recommendation:
          intake.roomType === "bathroom"
            ? "Skip decorative accent lighting unless the electrician confirms IP ratings."
            : "Use accent light only to highlight architecture or décor, not as the only source.",
      },
    ],
    fixtures: [
      "Ceiling or recessed ambient fittings sized after a site visit.",
      "Task pendants, under-cabinet, or desk lights as the room requires.",
      "Wall or accent fittings only if the circuit and IP rating allow it.",
    ],
    energy:
      "Prefer LED lamps with a stated lumens-per-watt rating from the product sheet. WAVE does not invent energy-star claims or supplier SKUs.",
    openQuestions: questions,
    nextStep,
  };
}
