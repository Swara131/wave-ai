import { z } from "zod";
import { FEEDBACK_REASONS } from "./constants";
import type { GroupIntake, GroupParticipant } from "./types";

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((value) => (value ? value : undefined));

export const participantSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  displayName: z.string().trim().min(2, "Enter a participant name.").max(80),
  likes: z
    .array(z.string().trim().min(1).max(120))
    .min(3, "Each person needs at least three likes."),
  dislikes: optionalText,
  dietary: optionalText,
  accessibility: optionalText,
  preferredCuisines: optionalText,
  neighborhood: optionalText,
  maxTravelMinutes: z.coerce.number().int().min(5).max(240).optional(),
  hardBudgetInr: z.coerce.number().finite().min(200).max(5_000_000).optional(),
});

export const groupIntakeSchema = z
  .object({
    groupName: z.string().trim().min(2, "Enter a group name.").max(120),
    city: z.string().trim().min(2, "Enter a destination city.").max(80),
    outingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the outing date."),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, "Enter a start time."),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
    maxBudgetInr: z.coerce.number().finite().min(500, "Budget must be at least ₹500.").max(5_000_000),
    budgetCurrency: z.string().trim().min(3).max(8).default("INR"),
    maxTravelMinutes: z.coerce.number().int().min(5).max(240),
    participants: z.array(participantSchema).min(2, "Add at least two participants.").max(12),
    isDraft: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.endTime && value.endTime <= value.startTime) {
      ctx.addIssue({ code: "custom", message: "End time must be after start time.", path: ["endTime"] });
    }
    const names = value.participants.map((item) => item.displayName.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: "custom", message: "Participant names must be unique.", path: ["participants"] });
    }
  });

export function groupFieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "form";
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export function normalizeGroupIntake(input: z.infer<typeof groupIntakeSchema>, existing?: GroupParticipant[]): GroupIntake {
  return {
    groupName: input.groupName.trim(),
    city: input.city.trim(),
    outingDate: input.outingDate,
    startTime: input.startTime,
    endTime: input.endTime || undefined,
    maxBudgetInr: Math.round(input.maxBudgetInr),
    budgetCurrency: input.budgetCurrency.trim().toUpperCase() || "INR",
    maxTravelMinutes: input.maxTravelMinutes,
    isDraft: input.isDraft ?? false,
    participants: input.participants.map((person, index) => {
      const previous = existing?.find((item) => item.id === person.id) ?? existing?.[index];
      return {
        id: person.id?.trim() || previous?.id || `person-${index + 1}`,
        displayName: person.displayName.trim(),
        likes: person.likes.map((like) => like.trim()).filter(Boolean),
        dislikes: person.dislikes,
        dietary: person.dietary,
        accessibility: person.accessibility,
        preferredCuisines: person.preferredCuisines,
        neighborhood: person.neighborhood,
        maxTravelMinutes: person.maxTravelMinutes,
        hardBudgetInr: person.hardBudgetInr,
      };
    }),
  };
}

export const groupFeedbackSchema = z.object({
  outingId: z.string().uuid(),
  participantId: z.string().min(2),
  restaurantId: z.string().min(2),
  reason: z.enum(FEEDBACK_REASONS),
  note: optionalText,
});

export const groupSelectSchema = z.object({
  outingId: z.string().uuid(),
  restaurantId: z.string().min(2),
});

export const groupReserveSchema = z.object({
  outingId: z.string().uuid(),
  confirmedReview: z.literal(true),
});

export const groupUndoSchema = z.object({
  outingId: z.string().uuid(),
  feedbackId: z.string().min(4),
});

export const groupSettingsSchema = z.object({
  reservationThresholdInr: z.coerce.number().int().min(100).max(10_000_000),
});

export const groupActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("discover"), outingId: z.string().uuid() }),
  z.object({
    action: z.literal("feedback"),
    outingId: z.string().uuid(),
    participantId: z.string().min(2),
    restaurantId: z.string().min(2),
    reason: z.enum(FEEDBACK_REASONS),
    note: optionalText,
  }),
  z.object({ action: z.literal("undo"), outingId: z.string().uuid(), feedbackId: z.string().min(4) }),
  z.object({ action: z.literal("select"), outingId: z.string().uuid(), restaurantId: z.string().min(2) }),
  z.object({ action: z.literal("reserve"), outingId: z.string().uuid(), confirmedReview: z.literal(true) }),
  z.object({
    action: z.literal("settings"),
    reservationThresholdInr: z.coerce.number().int().min(100).max(10_000_000),
  }),
]);
