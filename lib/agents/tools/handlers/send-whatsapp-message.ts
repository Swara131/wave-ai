import {
  parseDeliverySettings,
  resolveDestinationPhone,
  shouldBlockExternalDeliveryTools,
} from "@/lib/agents/delivery/settings";
import { sendWhatsAppText } from "@/lib/whatsapp/client";
import { WhatsAppSendError } from "@/lib/whatsapp/errors";
import { normalizeWhatsAppRecipient } from "@/lib/whatsapp/phone";
import type { ToolExecutionOutcome, ToolHandlerContext } from "../../runtime/types";

export async function handleSendWhatsAppMessage(
  input: Record<string, unknown>,
  context: ToolHandlerContext
): Promise<ToolExecutionOutcome> {
  const delivery = parseDeliverySettings(context.agent.record.safetySettings);
  if (shouldBlockExternalDeliveryTools(delivery.mode)) {
    return {
      executed: false,
      error: "This agent notifies you in Wave only. WhatsApp was not sent.",
      output: { blocked: "wave_only" },
    };
  }
  const configuredTo = resolveDestinationPhone({ delivery });

  let toE164: string;
  try {
    const rawTo =
      (typeof input.to === "string" && input.to.trim()) ||
      (typeof input.phone === "string" && input.phone.trim()) ||
      configuredTo ||
      "";
    toE164 = normalizeWhatsAppRecipient(rawTo);
  } catch (err) {
    return {
      executed: false,
      error: err instanceof Error ? err.message : "Invalid WhatsApp recipient.",
      output: {},
    };
  }

  const message =
    (typeof input.message === "string" && input.message.trim()) ||
    (typeof input.body === "string" && input.body.trim()) ||
    "";

  if (!message) {
    return {
      executed: false,
      error: "WhatsApp message body is required.",
      output: {},
    };
  }

  try {
    const { messageId, provider } = await sendWhatsAppText({ toE164, body: message });
    return {
      executed: true,
      output: {
        messageId,
        provider,
        to: toE164.replace(/(\+\d{2})\d+(\d{4})/, "$1••••••$2"),
      },
    };
  } catch (err) {
    const error =
      err instanceof WhatsAppSendError
        ? err.message
        : err instanceof Error
          ? err.message
          : "WhatsApp send failed.";
    return {
      executed: false,
      error,
      output: {},
    };
  }
}
