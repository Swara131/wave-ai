import { z } from "zod";
import {
  JOB_KINDS,
  LIGHTING_PREFERENCES,
  ROOM_TYPES,
  STYLE_OPTIONS,
} from "./constants";
import type { LightingIntake } from "./types";

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((value) => (value ? value : undefined));

const optionalCount = z
  .union([z.null(), z.literal(""), z.coerce.number().int().min(1).max(80)])
  .optional()
  .transform((value) => (typeof value === "number" ? value : undefined));

export const lightingIntakeSchema = z
  .object({
    customerName: z.string().trim().min(2, "Enter the customer name.").max(120),
    contactEmail: z
      .string()
      .trim()
      .email("Enter a valid email.")
      .max(254)
      .optional()
      .or(z.literal("")),
    contactPhone: z
      .string()
      .trim()
      .max(20)
      .regex(/^[+0-9().\-\s]*$/, "Enter a phone number using digits only.")
      .optional()
      .or(z.literal("")),
    roomType: z.enum(ROOM_TYPES),
    roomPurpose: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .or(z.literal(""))
      .transform((value) => value ?? ""),
    preferredStyle: z.enum(STYLE_OPTIONS),
    lightingPreference: z.enum(LIGHTING_PREFERENCES),
    budgetInr: z.coerce.number().finite().min(500, "Budget must be at least ₹500.").max(5_000_000),
    serviceAddress: z
      .string()
      .trim()
      .max(400)
      .optional()
      .or(z.literal(""))
      .transform((value) => value ?? ""),
    jobKind: z.enum(JOB_KINDS),
    roomDimensions: optionalText,
    ceilingHeight: optionalText,
    existingFixtures: optionalText,
    lightsNeeded: optionalCount,
    preferredAppointmentAt: z.string().trim().max(40).optional().or(z.literal("")),
    additionalPreferences: optionalText,
  })
  .superRefine((value, ctx) => {
    const email = value.contactEmail?.trim();
    const phone = value.contactPhone?.trim();
    if (!email && !phone) {
      ctx.addIssue({
        code: "custom",
        message: "Provide an email address or a phone number.",
        path: ["contactEmail"],
      });
    }
  });

export type LightingIntakeInput = z.infer<typeof lightingIntakeSchema>;

export function lightingIntakeErrorMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the intake form and try again.";
}

export function lightingIntakeFieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (!key || fields[key]) continue;
    fields[key] = issue.message;
  }
  return fields;
}

export function normalizeLightingIntake(input: LightingIntakeInput): LightingIntake {
  return {
    customerName: input.customerName.trim(),
    contactEmail: input.contactEmail?.trim() || undefined,
    contactPhone: input.contactPhone?.trim() || undefined,
    roomType: input.roomType,
    roomPurpose: input.roomPurpose.trim() || `${input.roomType.replaceAll("_", " ")} lighting plan`,
    preferredStyle: input.preferredStyle,
    lightingPreference: input.lightingPreference,
    budgetInr: Math.round(input.budgetInr),
    serviceAddress: (input.serviceAddress ?? "").trim(),
    jobKind: input.jobKind,
    roomDimensions: input.roomDimensions,
    ceilingHeight: input.ceilingHeight,
    existingFixtures: input.existingFixtures,
    lightsNeeded: input.lightsNeeded,
    preferredAppointmentAt: input.preferredAppointmentAt?.trim() || undefined,
    additionalPreferences: input.additionalPreferences,
  };
}

export const lightingRatesSchema = z.object({
  labourPerHourInr: z.number().finite().min(0).max(50_000),
  ambientFixtureInr: z.number().finite().min(0).max(200_000),
  taskFixtureInr: z.number().finite().min(0).max(200_000),
  accentFixtureInr: z.number().finite().min(0).max(200_000),
  travelInr: z.number().finite().min(0).max(50_000),
});

export const lightingVisitSchema = z.object({
  jobId: z.string().uuid(),
  customerConfirmed: z.literal(true),
  preferredAppointmentAt: z.string().trim().max(40).optional(),
});

export const lightingAddressSchema = z.object({
  jobId: z.string().uuid(),
});
