import { z } from "zod";
import { lightingIntakeSchema, normalizeLightingIntake } from "@/lib/lighting-concierge/intake";
import { buildLightingPlan } from "@/lib/lighting-concierge/plan";
import { buildLightingQuote, defaultLightingRates } from "@/lib/lighting-concierge/pricing";
import { fetchWebPlaceHints } from "@/lib/taste/web-places";
import { travelIntakeSchema, normalizeTravelIntake } from "@/lib/travel-companion/intake";
import { buildTravelItinerary } from "@/lib/travel-companion/itinerary";
import { weddingIntakeSchema, normalizeWeddingIntake } from "@/lib/wedding-planner/intake";
import { buildBudget, buildWeddingPlan, compareVendors } from "@/lib/wedding-planner/plan";
import { groupIntakeSchema, normalizeGroupIntake } from "@/lib/group-planner/intake";
import { candidatesFromPlaces, candidatesFromPreferences, pickThreeRecommendations } from "@/lib/group-planner/score";
import { getPublicGalleryTemplates, isPublicGallerySlug, type PublicGallerySlug } from "./public-gallery";

export type PreviewExecutionStatus = "preview" | "completed" | "failed";

export interface GuestPreviewResult {
  slug: PublicGallerySlug;
  templateName: string;
  status: PreviewExecutionStatus;
  preview: true;
  persisted: false;
  summary: string;
  sources: string[];
  warnings: string[];
  result: Record<string, unknown>;
}

function galleryName(slug: PublicGallerySlug): string {
  return getPublicGalleryTemplates().find((item) => item.slug === slug)?.name ?? slug;
}

export async function runGuestTemplatePreview(
  slug: string,
  intake: unknown
): Promise<GuestPreviewResult> {
  if (!isPublicGallerySlug(slug)) {
    throw new PreviewValidationError("Unknown template.");
  }

  if (slug === "lighting-concierge") {
    const parsed = lightingIntakeSchema.safeParse(intake);
    if (!parsed.success) throw new PreviewValidationError(parsed.error.issues[0]?.message ?? "Invalid lighting intake.");
    const normalized = normalizeLightingIntake(parsed.data);
    const rates = defaultLightingRates();
    const quote = buildLightingQuote(normalized, rates);
    const plan = buildLightingPlan(normalized, quote);
    const warnings = [
      "Guest preview is not saved to an account.",
      "WAVE will not book an electrician from this preview.",
      quote.complete ? null : "The estimate is incomplete because some quantities were assumed.",
      "Plan uses stated room details, style, budget, and the rate table.",
    ].filter((item): item is string => Boolean(item));
    return {
      slug,
      templateName: galleryName(slug),
      status: "preview",
      preview: true,
      persisted: false,
      summary: `${plan.styleAndAmbience.slice(0, 140)} Estimate ₹${quote.totalInr.toLocaleString("en-IN")} (non-binding).`,
      sources: ["stated_preferences", "rate_table"],
      warnings,
      result: {
        intake: { ...normalized, contactEmail: undefined, contactPhone: undefined },
        plan,
        quote,
      },
    };
  }

  if (slug === "travel-companion") {
    const parsed = travelIntakeSchema.safeParse(intake);
    if (!parsed.success) throw new PreviewValidationError(parsed.error.issues[0]?.message ?? "Invalid travel intake.");
    const normalized = normalizeTravelIntake(parsed.data);
    const taste = await fetchWebPlaceHints({
      query: `${normalized.destination} ${normalized.interests.slice(0, 3).join(" ")} things to do`.trim(),
      signals: [normalized.destination, ...normalized.interests, normalized.favoriteCuisines ?? ""],
    });
    const itinerary = buildTravelItinerary(normalized, taste);
    const warnings = [
      "Guest preview is not saved to an account.",
      "No tickets or reservations are created from this preview.",
      itinerary.conflicts.length ? itinerary.conflicts.join(" ") : null,
      itinerary.missingInformation.slice(0, 2).join(" ") || null,
      taste.source === "web_search" ? null : taste.error ?? "Stops are labelled from stated interests.",
    ].filter((item): item is string => Boolean(item));
    return {
      slug,
      templateName: galleryName(slug),
      status: "preview",
      preview: true,
      persisted: false,
      summary: `${itinerary.days.length}-day plan for ${normalized.destination}. Prices and hours are unverified.`,
      sources: [taste.source],
      warnings,
      result: { intake: normalized, itinerary, taste: { source: taste.source, queriedAt: taste.queriedAt, error: taste.error ?? null } },
    };
  }

  if (slug === "wedding-celebration-planner") {
    const parsed = weddingIntakeSchema.safeParse(intake);
    if (!parsed.success) throw new PreviewValidationError(parsed.error.issues[0]?.message ?? "Invalid wedding intake.");
    const normalized = normalizeWeddingIntake(parsed.data);
    const plan = buildWeddingPlan(normalized);
    const budget = buildBudget({ intake: normalized, vendors: [], deposits: [] });
    const comparison = compareVendors([], normalized);
    return {
      slug,
      templateName: galleryName(slug),
      status: "preview",
      preview: true,
      persisted: false,
      summary: `Plan for ${normalized.eventName} in ${normalized.location}. No vendors or deposits were created.`,
      sources: ["stated_preferences"],
      warnings: [
        "Guest preview is not saved to an account.",
        "Vendors must be entered by the organizer after sign-in.",
        "No vendors were invented. Add real quotes after you sign in.",
        "No deposit or invitation is sent from this preview.",
      ],
      result: { intake: normalized, plan, budget, comparison, vendors: [] },
    };
  }

  const parsed = groupIntakeSchema.safeParse(intake);
  if (!parsed.success) throw new PreviewValidationError(parsed.error.issues[0]?.message ?? "Invalid group intake.");
  const normalized = normalizeGroupIntake(parsed.data);
  const likes = normalized.participants.flatMap((person) => [...person.likes, person.preferredCuisines ?? ""]);
  const retrievedAt = new Date().toISOString();
  const taste = await fetchWebPlaceHints({
    query: `${normalized.city} restaurants ${likes.filter(Boolean).slice(0, 4).join(" ")}`.trim(),
    signals: [normalized.city, ...likes],
  });
  const candidates = [
    ...candidatesFromPreferences(normalized, retrievedAt),
    ...candidatesFromPlaces(
      taste.places.map((place) => ({ id: place.url ?? place.name, name: place.name })),
      taste.queriedAt,
      "web_search"
    ),
  ];
  const picked = pickThreeRecommendations(candidates, normalized, []);
  const warnings = [
    "Guest preview is not saved to an account.",
    "WAVE will not reserve a table from this preview.",
    picked.tooFewReason,
    taste.source === "web_search" ? null : taste.error ?? "WAVE did not invent restaurants.",
  ].filter((item): item is string => Boolean(item));
  return {
    slug,
    templateName: galleryName(slug),
    status: picked.recommendations.length ? "preview" : "failed",
    preview: true,
    persisted: false,
    summary: picked.recommendations.length
      ? `Ranked ${picked.recommendations.length} restaurant option(s) in ${normalized.city}.`
      : picked.tooFewReason ?? "Not enough valid restaurant candidates.",
    sources: [taste.source],
    warnings,
    result: {
      intake: normalized,
      recommendations: picked.recommendations,
      tooFewReason: picked.tooFewReason,
      candidateCount: candidates.length,
      taste: { source: taste.source, queriedAt: taste.queriedAt, error: taste.error ?? null },
    },
  };
}

export class PreviewValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewValidationError";
  }
}

export function parsePreviewSlug(value: unknown): PublicGallerySlug {
  const slug = typeof value === "string" ? value.trim() : "";
  if (!isPublicGallerySlug(slug)) {
    throw new PreviewValidationError("Unknown template.");
  }
  return slug;
}

export const guestPreviewRequestSchema = z.object({
  slug: z.string().trim().min(1),
  intake: z.record(z.string(), z.unknown()),
});
