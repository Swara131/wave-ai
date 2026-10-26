import { createHash } from "node:crypto";
import type { LightingIntake, LightingQuote, LightingRates, QuoteLine } from "./types";

export const DEFAULT_LIGHTING_RATES: Omit<LightingRates, "updatedAt"> = {
  labourPerHourInr: 450,
  ambientFixtureInr: 1_200,
  taskFixtureInr: 900,
  accentFixtureInr: 700,
  travelInr: 300,
  currency: "INR",
  source: "provider_configured",
};

export function defaultLightingRates(): LightingRates {
  return { ...DEFAULT_LIGHTING_RATES, updatedAt: new Date().toISOString() };
}

function roomFixtureCounts(intake: LightingIntake): {
  ambient: number;
  task: number;
  accent: number;
  labourHours: number;
  complete: boolean;
} {
  const requested = intake.lightsNeeded;
  const fallback = {
    living_room: { ambient: 2, task: 1, accent: 1, labourHours: 4 },
    bedroom: { ambient: 1, task: 1, accent: 1, labourHours: 3 },
    kitchen: { ambient: 2, task: 2, accent: 0, labourHours: 5 },
    bathroom: { ambient: 1, task: 1, accent: 0, labourHours: 3 },
    office: { ambient: 1, task: 2, accent: 0, labourHours: 3 },
    outdoor: { ambient: 2, task: 0, accent: 1, labourHours: 4 },
    other: { ambient: 1, task: 1, accent: 1, labourHours: 3 },
  }[intake.roomType];

  if (typeof requested === "number") {
    const ambient = Math.max(1, Math.round(requested * 0.5));
    const task = Math.max(intake.roomType === "outdoor" ? 0 : 1, Math.round(requested * 0.3));
    const accent = Math.max(0, requested - ambient - task);
    return {
      ambient,
      task,
      accent,
      labourHours: fallback.labourHours,
      complete: true,
    };
  }

  return { ...fallback, complete: Boolean(intake.roomDimensions || intake.ceilingHeight) };
}

function line(
  id: string,
  label: string,
  quantity: number,
  unitInr: number,
  assumption: string
): QuoteLine {
  return {
    id,
    label,
    quantity,
    unitInr,
    totalInr: quantity * unitInr,
    assumption,
  };
}

export function buildLightingQuote(
  intake: LightingIntake,
  rates: LightingRates
): LightingQuote {
  const counts = roomFixtureCounts(intake);
  const lines = [
    line(
      "ambient",
      "Ambient fixtures (estimate)",
      counts.ambient,
      rates.ambientFixtureInr,
      "Count from room type or lights requested. Not a supplier catalogue price."
    ),
    line(
      "task",
      "Task fixtures (estimate)",
      counts.task,
      rates.taskFixtureInr,
      "Task lighting for work surfaces, reading, or cooking."
    ),
    line(
      "accent",
      "Accent fixtures (estimate)",
      counts.accent,
      rates.accentFixtureInr,
      "Accent lighting only where the room type typically uses it."
    ),
    line(
      "labour",
      "Electrician labour (estimate)",
      counts.labourHours,
      rates.labourPerHourInr,
      "Hours from the configured labour table for this room type."
    ),
    line(
      "travel",
      "Site visit / travel (estimate)",
      1,
      rates.travelInr,
      "Flat travel amount from the provider rate table."
    ),
  ].filter((item) => item.quantity > 0 && item.unitInr >= 0);

  const materialsInr = lines
    .filter((item) => item.id !== "labour" && item.id !== "travel")
    .reduce((sum, item) => sum + item.totalInr, 0);
  const labourInr = lines.find((item) => item.id === "labour")?.totalInr ?? 0;
  const travelInr = lines.find((item) => item.id === "travel")?.totalInr ?? 0;
  const totalInr = lines.reduce((sum, item) => sum + item.totalInr, 0);
  const complete = counts.complete && lines.length > 0 && totalInr > 0;

  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        intake,
        rates: {
          labourPerHourInr: rates.labourPerHourInr,
          ambientFixtureInr: rates.ambientFixtureInr,
          taskFixtureInr: rates.taskFixtureInr,
          accentFixtureInr: rates.accentFixtureInr,
          travelInr: rates.travelInr,
        },
        totalInr,
      })
    )
    .digest("hex");

  const assumptions = [
    "Amounts use the electrician's configured rate table, not live supplier quotes.",
    "This is an estimate, not a binding quote, until approvals and a site confirmation are complete.",
    "A qualified electrician must confirm wiring, load, and fittings on site.",
  ];
  if (!complete) {
    assumptions.push(
      "Room measurements or fixture count were incomplete, so this estimate stays uncertain."
    );
  }

  return {
    currency: "INR",
    lines,
    materialsInr,
    labourInr,
    travelInr,
    totalInr,
    complete,
    fingerprint,
    assumptions,
    binding: false,
    status: "draft",
    ratesSource: "provider_configured",
  };
}

export function inrToPaise(amountInr: number): number {
  return Math.round(amountInr * 100);
}
