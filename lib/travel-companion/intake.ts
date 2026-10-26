import { z } from "zod";
import { INTERESTS, PACES, TRANSPORTS } from "./constants";
import type { TravelIntake } from "./types";

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((value) => (value ? value : undefined));

export const travelIntakeSchema = z
  .object({
    replanTripId: z.string().uuid().optional(),
    destination: z.string().trim().min(2, "Enter a destination city or area.").max(120),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a start date."),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter an end date."),
    travelers: z.coerce.number().int().min(1, "Party size must be at least 1.").max(12),
    budgetAmount: z.coerce.number().finite().min(500, "Budget must be at least 500.").max(20_000_000),
    budgetCurrency: z.string().trim().min(3).max(8).default("INR"),
    interests: z.array(z.enum(INTERESTS)).min(1, "Pick at least one interest."),
    pace: z.enum(PACES),
    startingArea: optionalText,
    favoriteCuisines: optionalText,
    culturalInterests: optionalText,
    dietaryNeeds: optionalText,
    accessibilityNeeds: optionalText,
    preferredTransport: z.enum(TRANSPORTS).optional(),
    accommodation: optionalText,
    existingReservations: optionalText,
    avoid: optionalText,
    dayStartTime: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
    dayEndTime: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  })
  .superRefine((value, ctx) => {
    if (value.endDate < value.startDate) {
      ctx.addIssue({ code: "custom", message: "End date must be on or after the start date.", path: ["endDate"] });
    }
    const start = new Date(`${value.startDate}T00:00:00Z`);
    const end = new Date(`${value.endDate}T00:00:00Z`);
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (days > 14) {
      ctx.addIssue({ code: "custom", message: "Keep plans to 14 days or fewer.", path: ["endDate"] });
    }
  });

export type TravelIntakeInput = z.infer<typeof travelIntakeSchema>;

export function travelIntakeFieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export function normalizeTravelIntake(input: TravelIntakeInput): TravelIntake {
  return {
    destination: input.destination.trim(),
    startDate: input.startDate,
    endDate: input.endDate,
    travelers: input.travelers,
    budgetAmount: Math.round(input.budgetAmount),
    budgetCurrency: input.budgetCurrency.trim().toUpperCase() || "INR",
    interests: input.interests,
    pace: input.pace,
    startingArea: input.startingArea,
    favoriteCuisines: input.favoriteCuisines,
    culturalInterests: input.culturalInterests,
    dietaryNeeds: input.dietaryNeeds,
    accessibilityNeeds: input.accessibilityNeeds,
    preferredTransport: input.preferredTransport ?? "unspecified",
    accommodation: input.accommodation,
    existingReservations: input.existingReservations,
    avoid: input.avoid,
    dayStartTime: input.dayStartTime || undefined,
    dayEndTime: input.dayEndTime || undefined,
  };
}

export const travelBookingSchema = z.object({
  tripId: z.string().uuid(),
  activityId: z.string().min(4),
  partySize: z.coerce.number().int().min(1).max(12),
  contact: z.string().trim().max(120).optional(),
  confirmedReview: z.literal(true),
});

export const travelMutateSchema = z.object({
  tripId: z.string().uuid(),
  action: z.enum(["remove", "replace", "regenerate_day"]),
  activityId: z.string().min(4).optional(),
  dayIndex: z.coerce.number().int().min(0).max(13).optional(),
});

export const travelSettingsSchema = z.object({
  bookingThresholdInr: z.coerce.number().int().min(100).max(10_000_000),
});
