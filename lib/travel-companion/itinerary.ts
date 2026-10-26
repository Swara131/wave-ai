import { createHash, randomUUID } from "node:crypto";
import type { QlooTasteResult } from "@/lib/qloo/types";
import type { DayPart, Interest, Pace } from "./constants";
import { DAY_PARTS } from "./constants";
import type { TravelActivity, TravelDay, TravelIntake, TravelItinerary } from "./types";

const SLOTS: Record<Pace, Array<{ part: DayPart; start: string; end: string }>> = {
  relaxed: [
    { part: "morning", start: "10:00", end: "12:00" },
    { part: "afternoon", start: "15:00", end: "17:00" },
  ],
  balanced: [
    { part: "morning", start: "09:30", end: "11:30" },
    { part: "afternoon", start: "13:30", end: "16:00" },
    { part: "evening", start: "18:30", end: "20:30" },
  ],
  packed: [
    { part: "morning", start: "09:00", end: "11:00" },
    { part: "afternoon", start: "12:30", end: "15:00" },
    { part: "evening", start: "16:30", end: "19:00" },
  ],
};

const INTEREST_LABEL: Record<Interest, string> = {
  food: "food tasting",
  music: "live music or a listening stop",
  art: "an art stop",
  museums: "a museum visit",
  nature: "an outdoor or garden walk",
  shopping: "a local market browse",
  nightlife: "an evening neighbourhood stroll",
  history: "a heritage walk",
  adventure: "a low-impact outdoor activity",
  family: "a family-friendly outing",
};

function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor.getTime() <= last.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

function overlap(a: TravelActivity, b: TravelActivity): boolean {
  if (a.dayDate !== b.dayDate) return false;
  return a.startTime < b.endTime && b.startTime < a.endTime;
}

export function activitiesOverlap(a: TravelActivity, b: TravelActivity): boolean {
  return overlap(a, b);
}

function qlooHints(qloo: QlooTasteResult, interest: Interest): { title?: string; evidence?: string } {
  if (qloo.source !== "qloo") return {};
  const pool = [...qloo.entities, ...qloo.tags];
  if (pool.length === 0) return {};
  const index = INTEREST_LABEL[interest].length % pool.length;
  const picked = pool[index];
  const name = "name" in picked ? picked.name : "";
  if (!name) return {};
  return {
    title: `${name} affinity — ${INTEREST_LABEL[interest]} in this destination`,
    evidence: `Qloo returned “${name}” for the traveler's stated ${interest} interest. This is a taste signal, not verified hours, tickets, or a reserved table.`,
  };
}

function buildActivity(params: {
  intake: TravelIntake;
  qloo: QlooTasteResult;
  dayIndex: number;
  dayDate: string;
  part: DayPart;
  start: string;
  end: string;
  interest: Interest;
}): TravelActivity {
  const hint = qlooHints(params.qloo, params.interest);
  const qlooInformed = Boolean(hint.title);
  const area = params.intake.startingArea ? ` near ${params.intake.startingArea}` : "";
  const title =
    hint.title ??
    `${INTEREST_LABEL[params.interest]} in ${params.intake.destination}${area}`;
  const flags = [
    "Venue identity, opening hours, and live prices are unverified.",
    "Travel time between stops is unknown because no routing provider is configured.",
  ];
  if (params.intake.dietaryNeeds && params.interest === "food") {
    flags.push(`Dietary note to confirm on site: ${params.intake.dietaryNeeds}.`);
  }
  if (params.intake.accessibilityNeeds) {
    flags.push(`Accessibility note to confirm on site: ${params.intake.accessibilityNeeds}.`);
  }
  if (params.intake.avoid) flags.push(`Avoid: ${params.intake.avoid}.`);

  return {
    id: randomUUID(),
    dayIndex: params.dayIndex,
    dayDate: params.dayDate,
    part: params.part,
    startTime: params.start,
    endTime: params.end,
    title,
    category: params.interest,
    location: `${params.intake.destination}${area} (address unknown)`,
    durationMinutes: minutesBetween(params.start, params.end),
    estimatedCostPerPerson: null,
    costVerified: false,
    reason: qlooInformed
      ? hint.evidence ?? "Matched from Qloo taste data and the traveler's stated interests."
      : `Planned from the traveler's stated ${params.interest} interest. Qloo taste data was not used for this stop.`,
    qlooInformed,
    qlooEvidence: hint.evidence,
    source: qlooInformed ? "qloo" : "stated_preferences",
    availability: "unknown",
    hoursVerified: false,
    travelTimeVerified: false,
    bookingRequired: params.interest === "food" || params.interest === "museums" || params.interest === "music",
    flags,
  };
}

export function buildTravelItinerary(intake: TravelIntake, qloo: QlooTasteResult): TravelItinerary {
  const dates = datesBetween(intake.startDate, intake.endDate);
  const slots = SLOTS[intake.pace];
  const days: TravelDay[] = dates.map((date, dayIndex) => {
    const activities = slots.map((slot, slotIndex) => {
      const interest = intake.interests[(dayIndex + slotIndex) % intake.interests.length];
      return buildActivity({
        intake,
        qloo,
        dayIndex,
        dayDate: date,
        part: slot.part,
        start: intake.dayStartTime && slot.part === "morning" ? intake.dayStartTime : slot.start,
        end: slot.end,
        interest,
      });
    });
    return { date, index: dayIndex, activities };
  });

  const conflicts: string[] = [];
  const all = days.flatMap((day) => day.activities);
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      if (overlap(all[i], all[j])) {
        conflicts.push(`${all[i].title} overlaps ${all[j].title} on ${all[i].dayDate}.`);
      }
    }
  }

  const missingInformation = [
    "No places or events provider is configured, so venues are unverified.",
    "No routing provider is configured, so travel times are unknown.",
    "Costs are unknown until a venue or ticket provider confirms them.",
  ];
  if (intake.budgetCurrency !== "INR") {
    missingInformation.push("Budget is not in INR. WAVE cannot convert currencies without a verified rate source.");
  }

  return {
    days,
    plannedSpendInr: null,
    remainingBudgetInr: intake.budgetCurrency === "INR" ? intake.budgetAmount : null,
    currency: intake.budgetCurrency,
    conflicts,
    missingInformation,
    generatedAt: new Date().toISOString(),
  };
}

export function itineraryFingerprint(intake: TravelIntake): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        destination: intake.destination,
        startDate: intake.startDate,
        endDate: intake.endDate,
        travelers: intake.travelers,
        budgetAmount: intake.budgetAmount,
        budgetCurrency: intake.budgetCurrency,
        interests: intake.interests,
        pace: intake.pace,
        startingArea: intake.startingArea ?? "",
      })
    )
    .digest("hex");
}

export function replaceActivity(itinerary: TravelItinerary, activityId: string, intake: TravelIntake, qloo: QlooTasteResult): TravelItinerary {
  const nextDays = itinerary.days.map((day) => ({
    ...day,
    activities: day.activities.map((activity) => {
      if (activity.id !== activityId) return activity;
      const nextInterest = intake.interests[(activity.dayIndex + 1) % intake.interests.length];
      return buildActivity({
        intake,
        qloo,
        dayIndex: activity.dayIndex,
        dayDate: activity.dayDate,
        part: activity.part,
        start: activity.startTime,
        end: activity.endTime,
        interest: nextInterest,
      });
    }),
  }));
  return { ...itinerary, days: nextDays, generatedAt: new Date().toISOString() };
}

export function removeActivity(itinerary: TravelItinerary, activityId: string): TravelItinerary {
  return {
    ...itinerary,
    days: itinerary.days.map((day) => ({
      ...day,
      activities: day.activities.filter((activity) => activity.id !== activityId),
    })),
    generatedAt: new Date().toISOString(),
  };
}

export function regenerateDay(
  itinerary: TravelItinerary,
  dayIndex: number,
  intake: TravelIntake,
  qloo: QlooTasteResult
): TravelItinerary {
  const slots = SLOTS[intake.pace];
  return {
    ...itinerary,
    days: itinerary.days.map((day) => {
      if (day.index !== dayIndex) return day;
      return {
        ...day,
        activities: slots.map((slot, slotIndex) =>
          buildActivity({
            intake,
            qloo,
            dayIndex,
            dayDate: day.date,
            part: slot.part,
            start: intake.dayStartTime && slot.part === "morning" ? intake.dayStartTime : slot.start,
            end: slot.end,
            interest: intake.interests[(dayIndex + slotIndex + 1) % intake.interests.length],
          })
        ),
      };
    }),
    generatedAt: new Date().toISOString(),
  };
}

export function findActivity(itinerary: TravelItinerary, activityId: string): TravelActivity | null {
  for (const day of itinerary.days) {
    const found = day.activities.find((activity) => activity.id === activityId);
    if (found) return found;
  }
  return null;
}

export { DAY_PARTS };
