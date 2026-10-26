import type { AgentSafetySettings } from "../runtime-types";
import { isResendConfigured } from "@/lib/email/is-resend-configured";
import { isTwilioWhatsAppConfigured } from "@/lib/whatsapp/env";
import { normalizeWhatsAppRecipient } from "@/lib/whatsapp/phone";
import type { AgentDeliveryMode, AgentDeliverySettings } from "./types";

function isDeliveryMode(value: unknown): value is AgentDeliveryMode {
  return (
    value === "email" ||
    value === "whatsapp" ||
    value === "notification" ||
    value === "both" ||
    value === "none"
  );
}

export function parseDeliverySettings(
  safetySettings: AgentSafetySettings | undefined | null
): AgentDeliverySettings {
  const raw = safetySettings?.delivery;
  if (raw && typeof raw === "object" && isDeliveryMode(raw.mode)) {
    const destinationEmail =
      typeof raw.destinationEmail === "string" ? raw.destinationEmail.trim() : null;
    const destinationPhone =
      typeof raw.destinationPhone === "string" ? raw.destinationPhone.trim() : null;
    const mode =
      raw.mode === "email" && !destinationEmail
        ? "notification"
        : raw.mode === "whatsapp" && !destinationPhone
          ? "notification"
          : raw.mode === "both" && !destinationEmail && !destinationPhone
            ? "notification"
            : raw.mode;
    return {
      mode,
      destinationEmail,
      destinationPhone,
    };
  }

  return { mode: "notification", destinationEmail: null, destinationPhone: null };
}

export function mergeDeliverySettings(
  safetySettings: AgentSafetySettings,
  delivery: AgentDeliverySettings
): AgentSafetySettings {
  return {
    ...safetySettings,
    delivery: {
      mode: delivery.mode,
      destinationEmail: delivery.destinationEmail?.trim() || null,
      destinationPhone: delivery.destinationPhone?.trim() || null,
    },
  };
}

/**
 * Apply a setup answer to delivery settings without hijacking an explicit
 * Wave (in-app) choice into email or WhatsApp.
 */
export function applyPendingDeliveryAnswer(
  delivery: AgentDeliverySettings,
  pendingKey: string,
  value: string
): AgentDeliverySettings {
  const trimmed = value.trim();
  const next: AgentDeliverySettings = {
    mode: delivery.mode,
    destinationEmail: delivery.destinationEmail ?? null,
    destinationPhone: delivery.destinationPhone ?? null,
  };

  if (pendingKey === "email") {
    next.destinationEmail = trimmed;
  }
  if (pendingKey === "whatsapp") {
    next.destinationPhone = trimmed;
  }

  const outputKey = pendingKey === "output_destination" || pendingKey === "output";
  if (outputKey) {
    const output = trimmed.toLowerCase();
    if (output === "email") next.mode = "email";
    else if (output === "whatsapp") next.mode = "whatsapp";
    else if (
      output === "notification" ||
      output === "slack" ||
      output === "wave" ||
      output === "in_app"
    ) {
      next.mode = "notification";
    }
  }

  return next;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function resolveDestinationEmail(params: {
  delivery: AgentDeliverySettings;
  userEmail?: string;
}): string | null {
  const configured = params.delivery.destinationEmail?.trim();
  if (configured && EMAIL_PATTERN.test(configured)) return configured;
  return null;
}

export function resolveDestinationPhone(params: {
  delivery: AgentDeliverySettings;
}): string | null {
  const configured = params.delivery.destinationPhone?.trim();
  if (!configured) return null;
  try {
    return normalizeWhatsAppRecipient(configured);
  } catch {
    return null;
  }
}

export function destinationEmailError(mode: AgentDeliverySettings["mode"]): string {
  if (mode === "email" || mode === "both") {
    return "Add a destination email to receive agent results.";
  }
  return "No delivery destination configured.";
}

export function destinationPhoneError(mode: AgentDeliverySettings["mode"]): string {
  if (mode === "whatsapp" || mode === "both") {
    return "Add a WhatsApp recipient number in international format (e.g. +919876543210).";
  }
  return "No WhatsApp recipient configured.";
}

export function shouldDeliverForRunMode(mode: string | undefined): boolean {
  return mode === "scheduled" || mode === "manual" || mode === "live" || mode === "test";
}

export function shouldDeliverWhatsApp(mode: AgentDeliveryMode): boolean {
  return mode === "whatsapp" || mode === "both";
}

export function shouldDeliverEmail(mode: AgentDeliveryMode): boolean {
  return mode === "email" || mode === "both";
}

export function shouldDeliverInAppNotification(mode: AgentDeliveryMode): boolean {
  return mode === "notification";
}

/** True when post-run delivery should create a Wave / email / WhatsApp result. */
export function needsPostRunDelivery(params: {
  mode: AgentDeliveryMode;
  emailedAlready: boolean;
  whatsappAlready: boolean;
}): boolean {
  return (
    shouldDeliverInAppNotification(params.mode) ||
    (shouldDeliverEmail(params.mode) && !params.emailedAlready) ||
    (shouldDeliverWhatsApp(params.mode) && !params.whatsappAlready)
  );
}

/** External send_email / WhatsApp tools must not fire when the user chose Wave only. */
export function shouldBlockExternalDeliveryTools(mode: AgentDeliveryMode): boolean {
  return mode === "notification" || mode === "none";
}

export function isEmailDeliveryConnected(): boolean {
  return isResendConfigured();
}

export function isWhatsAppDeliveryConnected(): boolean {
  return isTwilioWhatsAppConfigured();
}

/** UI label for delivery mode including legacy notification. */
export function validateDeliverySettings(
  delivery: AgentDeliverySettings
): { valid: true } | { valid: false; error: string } {
  if (shouldDeliverEmail(delivery.mode) && !delivery.destinationEmail?.trim()) {
    return { valid: false, error: destinationEmailError(delivery.mode) };
  }

  if (shouldDeliverWhatsApp(delivery.mode)) {
    const phone = delivery.destinationPhone?.trim();
    if (!phone) {
      return { valid: false, error: destinationPhoneError(delivery.mode) };
    }
    try {
      normalizeWhatsAppRecipient(phone);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Enter a valid WhatsApp number.";
      return { valid: false, error: message };
    }
  }

  return { valid: true };
}

export function deliveryModeDisplayLabel(mode: AgentDeliveryMode): string {
  switch (mode) {
    case "email":
      return "Email";
    case "whatsapp":
      return "WhatsApp";
    case "both":
      return "Email and WhatsApp";
    case "notification":
      return "Wave in-app notification";
    default:
      return "None";
  }
}
