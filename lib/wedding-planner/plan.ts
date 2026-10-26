import { createHash, randomUUID } from "node:crypto";
import { BUDGET_CATEGORIES, type InviteTone } from "./constants";
import type {
  WeddingBudgetSnapshot,
  WeddingDeposit,
  WeddingIntake,
  WeddingPlan,
  WeddingRecommendation,
  WeddingTask,
  WeddingVendor,
} from "./types";

function tokens(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((token) => token.length > 3);
}

export function buildWeddingPlan(intake: WeddingIntake): WeddingPlan {
  const couple = tokens(intake.couplePreferences);
  const family = tokens(intake.familyPreferences);
  const shared = couple.filter((token) => family.includes(token));
  const differing: string[] = [];
  if (intake.familyPreferences && intake.familyPreferences.trim()) {
    const uniqueFamily = family.filter((token) => !couple.includes(token)).slice(0, 8);
    const uniqueCouple = couple.filter((token) => !family.includes(token)).slice(0, 8);
    if (uniqueFamily.length || uniqueCouple.length) {
      differing.push(
        "Couple and family notes do not fully overlap. WAVE will not pick a winner; both sets stay on the record."
      );
      if (uniqueCouple.length) differing.push(`Stated only by the couple/organizer: ${uniqueCouple.join(", ")}.`);
      if (uniqueFamily.length) differing.push(`Stated only in family notes: ${uniqueFamily.join(", ")}.`);
    }
  }

  const followUps: string[] = [];
  if (!intake.cuisine) followUps.push("What cuisine and dietary rules should catering follow?");
  if (!intake.music) followUps.push("What music or entertainment should the event include?");
  if (!intake.venueStyle) followUps.push("What venue style should shortlists prefer?");
  if (!intake.familyPreferences) followUps.push("Add family preference notes if they should be weighed separately.");

  const recommendations: WeddingRecommendation[] = [
    {
      id: randomUUID(),
      area: "venue",
      title: intake.venueStyle
        ? `${intake.venueStyle} venue style in ${intake.location}`
        : `Venue in ${intake.location} sized for about ${intake.guestCount} guests`,
      reason: intake.venueStyle
        ? `Matches the stated ${intake.venueStyle} venue style and guest count of ${intake.guestCount}. This is a style brief, not a verified property.`
        : `Sized from the stated guest count. No specific venue was named, so WAVE will not invent one.`,
      basedOn: ["guestCount", intake.venueStyle ? "venueStyle" : "location"],
      assumption: !intake.venueStyle,
      missingInformation: ["No places provider is configured. Add a real venue to the shortlist yourself."],
    },
    {
      id: randomUUID(),
      area: "cuisine",
      title: intake.cuisine ? "Catering brief from stated cuisine" : "Catering brief needs cuisine details",
      reason: intake.cuisine
        ? `Uses the organizer's cuisine notes: ${intake.cuisine}.`
        : "Cuisine was not provided, so WAVE will not assume a menu.",
      basedOn: intake.cuisine ? ["cuisine"] : ["couplePreferences"],
      assumption: !intake.cuisine,
      missingInformation: intake.cuisine ? [] : ["Add cuisine and dietary rules."],
    },
    {
      id: randomUUID(),
      area: "music",
      title: intake.music ? "Music brief from stated entertainment" : "Music brief is incomplete",
      reason: intake.music
        ? `Uses the stated entertainment notes: ${intake.music}.`
        : "No music preference was given.",
      basedOn: intake.music ? ["music"] : [],
      assumption: !intake.music,
      missingInformation: intake.music ? [] : ["Add music or entertainment preferences."],
    },
    {
      id: randomUUID(),
      area: "decor",
      title: intake.decorPalette ? `Décor palette: ${intake.decorPalette}` : "Décor palette not specified",
      reason: intake.decorPalette
        ? `Uses the stated colours and décor notes. This is not a supplier quote.`
        : "WAVE will not invent a décor scheme.",
      basedOn: intake.decorPalette ? ["decorPalette"] : [],
      assumption: !intake.decorPalette,
      missingInformation: [],
    },
    {
      id: randomUUID(),
      area: "entertainment",
      title: "Photography and entertainment stay unverified until vendors are entered",
      reason: intake.photographyStyle
        ? `Photography style noted as ${intake.photographyStyle}. WAVE will not invent a photographer.`
        : "No photographer was named. Add vendors from quotations you actually received.",
      basedOn: intake.photographyStyle ? ["photographyStyle"] : ["couplePreferences"],
      assumption: false,
      missingInformation: ["Enter real vendor names and quotes. WAVE does not search a places directory."],
    },
  ];

  return {
    sharedPreferences: shared.length ? [`Shared words in couple and family notes: ${shared.join(", ")}.`] : [],
    differingPreferences: differing,
    recommendations,
    followUps,
    source: "stated_preferences",
    generatedAt: new Date().toISOString(),
  };
}

export function vendorQuoteFingerprint(vendor: Pick<WeddingVendor, "id" | "quotedAmount" | "currency" | "name">): string {
  return createHash("sha256")
    .update(`${vendor.id}:${vendor.name}:${vendor.quotedAmount ?? "null"}:${vendor.currency}`)
    .digest("hex");
}

export function eventFingerprint(intake: WeddingIntake): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        eventName: intake.eventName,
        eventType: intake.eventType,
        startDate: intake.startDate,
        endDate: intake.endDate ?? "",
        location: intake.location,
        guestCount: intake.guestCount,
        budgetAmount: intake.budgetAmount,
      })
    )
    .digest("hex");
}

const CATEGORY_MAP: Record<WeddingVendor["category"], (typeof BUDGET_CATEGORIES)[number]> = {
  venue: "venue",
  caterer: "catering",
  decorator: "decor",
  photographer: "photography",
  videographer: "photography",
  music: "music",
  stylist: "clothing",
  other: "contingency",
};

export function buildBudget(params: {
  intake: WeddingIntake;
  vendors: WeddingVendor[];
  deposits: WeddingDeposit[];
}): WeddingBudgetSnapshot {
  const categories = Object.fromEntries(BUDGET_CATEGORIES.map((key) => [key, 0])) as WeddingBudgetSnapshot["categories"];
  let planned = 0;
  let pendingQuotes = 0;
  for (const vendor of params.vendors) {
    if (vendor.quotedAmount == null) continue;
    planned += vendor.quotedAmount;
    pendingQuotes += vendor.quotedAmount;
    categories[CATEGORY_MAP[vendor.category]] += vendor.quotedAmount;
  }
  const depositsRequested = params.deposits
    .filter((item) => item.status !== "rejected" && item.status !== "blocked")
    .reduce((sum, item) => sum + item.amount, 0);
  const depositsApproved = params.deposits
    .filter((item) => item.status === "approved_awaiting_payment" || item.status === "pending_payment")
    .reduce((sum, item) => sum + item.amount, 0);
  const remaining = params.intake.budgetCurrency === "INR" ? params.intake.budgetAmount - planned : null;
  return {
    total: params.intake.budgetAmount,
    currency: params.intake.budgetCurrency,
    planned,
    confirmed: 0,
    pendingQuotes,
    depositsRequested,
    depositsApproved,
    remaining,
    categories,
  };
}

export function findScheduleConflicts(tasks: WeddingTask[]): string[] {
  const conflicts: string[] = [];
  for (let i = 0; i < tasks.length; i += 1) {
    for (let j = i + 1; j < tasks.length; j += 1) {
      const a = tasks[i];
      const b = tasks[j];
      if (!a.vendorId || !b.vendorId || a.vendorId !== b.vendorId) continue;
      if (!a.dueDate || !b.dueDate || a.dueDate !== b.dueDate) continue;
      if (!a.startTime || !a.endTime || !b.startTime || !b.endTime) continue;
      if (a.startTime < b.endTime && b.startTime < a.endTime) {
        conflicts.push(`${a.title} overlaps ${b.title} for the same vendor on ${a.dueDate}.`);
      }
    }
  }
  return conflicts;
}

export function draftInvitation(params: {
  intake: WeddingIntake;
  tone: InviteTone;
  hostNames: string;
  venueName?: string;
  eventTime?: string;
  extraWording?: string;
}): string {
  const date = params.intake.endDate && params.intake.endDate !== params.intake.startDate
    ? `${params.intake.startDate} to ${params.intake.endDate}`
    : params.intake.startDate;
  const place = params.venueName ? `${params.venueName}, ${params.intake.location}` : params.intake.location;
  const time = params.eventTime ? ` at ${params.eventTime}` : "";
  const extra = params.extraWording ? `\n\n${params.extraWording}` : "";
  const openings: Record<string, string> = {
    traditional: "With the blessings of our families, we request the honour of your presence at",
    elegant: "You are cordially invited to",
    modern: "Join us for",
    warm: "We would love for you to celebrate",
    playful: "Come dance, eat, and cheer at",
  };
  return `${openings[params.tone]} ${params.intake.eventName}.\n\nHosted by ${params.hostNames}.\n${date}${time} · ${place}.\n\nThis draft was written from the event details you entered. It has not been sent.${extra}`;
}

export function compareVendors(vendors: WeddingVendor[], intake: WeddingIntake): string[] {
  const notes: string[] = [];
  const withQuotes = vendors.filter((vendor) => vendor.quotedAmount != null);
  if (withQuotes.length >= 2) {
    const sorted = [...withQuotes].sort((a, b) => (a.quotedAmount ?? 0) - (b.quotedAmount ?? 0));
    notes.push(
      `Lowest entered quote: ${sorted[0].name} at ${sorted[0].quotedAmount} ${sorted[0].currency}. Highest: ${sorted[sorted.length - 1].name}.`
    );
  }
  const overBudget = withQuotes.filter((vendor) => vendor.quotedAmount != null && vendor.quotedAmount > intake.budgetAmount);
  if (overBudget.length) {
    notes.push(`${overBudget.map((item) => item.name).join(", ")} exceed the total event budget on the entered quote.`);
  }
  const unknownAvailability = vendors.filter((vendor) => vendor.availability !== "verified");
  if (unknownAvailability.length) {
    notes.push("Availability is unverified for every vendor until you confirm it with them. WAVE will not claim a slot is free.");
  }
  return notes;
}
