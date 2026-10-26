import { z } from "zod";
import { EVENT_TYPES, INVITE_TONES, VENDOR_CATEGORIES, VENUE_STYLES } from "./constants";
import type { WeddingIntake } from "./types";

const optionalText = z
  .string()
  .trim()
  .max(4000)
  .optional()
  .transform((value) => (value ? value : undefined));

export const weddingIntakeSchema = z
  .object({
    eventName: z.string().trim().min(2, "Enter an event name.").max(160),
    eventType: z.enum(EVENT_TYPES),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter an event date."),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
    location: z.string().trim().min(2, "Enter a city or location.").max(120),
    guestCount: z.coerce.number().int().min(2, "Guest count must be at least 2.").max(20_000),
    budgetAmount: z.coerce.number().finite().min(1000, "Budget must be at least 1,000.").max(500_000_000),
    budgetCurrency: z.string().trim().min(3).max(8).default("INR"),
    couplePreferences: z.string().trim().min(8, "Describe the couple or organizer preferences.").max(4000),
    familyPreferences: optionalText,
    venueStyle: z.enum(VENUE_STYLES).optional(),
    cuisine: optionalText,
    music: optionalText,
    decorPalette: optionalText,
    photographyStyle: optionalText,
    fashionNotes: optionalText,
    accessibilityNeeds: optionalText,
    traditions: optionalText,
    contact: optionalText,
    existingVendorsNotes: optionalText,
    isDraft: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.endDate && value.endDate < value.startDate) {
      ctx.addIssue({ code: "custom", message: "End date must be on or after the start date.", path: ["endDate"] });
    }
  });

export type WeddingIntakeInput = z.infer<typeof weddingIntakeSchema>;

export function weddingFieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export function normalizeWeddingIntake(input: WeddingIntakeInput): WeddingIntake {
  return {
    eventName: input.eventName.trim(),
    eventType: input.eventType,
    startDate: input.startDate,
    endDate: input.endDate || undefined,
    location: input.location.trim(),
    guestCount: Math.round(input.guestCount),
    budgetAmount: Math.round(input.budgetAmount),
    budgetCurrency: input.budgetCurrency.trim().toUpperCase() || "INR",
    couplePreferences: input.couplePreferences.trim(),
    familyPreferences: input.familyPreferences,
    venueStyle: input.venueStyle,
    cuisine: input.cuisine,
    music: input.music,
    decorPalette: input.decorPalette,
    photographyStyle: input.photographyStyle,
    fashionNotes: input.fashionNotes,
    accessibilityNeeds: input.accessibilityNeeds,
    traditions: input.traditions,
    contact: input.contact,
    existingVendorsNotes: input.existingVendorsNotes,
    isDraft: input.isDraft ?? false,
  };
}

export const weddingVendorSchema = z.object({
  eventId: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  category: z.enum(VENDOR_CATEGORIES),
  location: optionalText,
  contact: optionalText,
  quotedAmount: z.coerce.number().finite().min(0).max(500_000_000).nullable().optional(),
  currency: z.string().trim().min(3).max(8).default("INR"),
  servicesIncluded: optionalText,
  cancellationTerms: optionalText,
  paymentRecipientId: optionalText,
  notes: optionalText,
});

export const weddingVendorActionSchema = z.object({
  eventId: z.string().uuid(),
  vendorId: z.string().min(4),
  action: z.enum(["approve", "remove", "update_quote"]),
  quotedAmount: z.coerce.number().finite().min(0).max(500_000_000).optional(),
});

export const weddingTaskSchema = z.object({
  eventId: z.string().uuid(),
  title: z.string().trim().min(2).max(200),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  vendorId: z.string().optional(),
});

export const weddingTaskActionSchema = z.object({
  eventId: z.string().uuid(),
  taskId: z.string().min(4),
  action: z.enum(["toggle", "remove"]),
});

export const weddingInviteSchema = z.object({
  eventId: z.string().uuid(),
  tone: z.enum(INVITE_TONES),
  hostNames: z.string().trim().min(2).max(160),
  venueName: optionalText,
  eventTime: optionalText,
  extraWording: optionalText,
});

export const weddingDepositSchema = z.object({
  eventId: z.string().uuid(),
  vendorId: z.string().min(4),
  amount: z.coerce.number().finite().min(1).max(50_000_000),
  recipientId: z.string().trim().min(2).max(120),
  confirmedReview: z.literal(true),
});

export const weddingSettingsSchema = z.object({
  depositThresholdInr: z.coerce.number().int().min(100).max(10_000_000),
});
