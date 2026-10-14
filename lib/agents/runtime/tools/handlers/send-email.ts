import { sendHtmlEmail } from "@/lib/email/resend-client";
import {
  parseDeliverySettings,
  shouldBlockExternalDeliveryTools,
} from "@/lib/agents/delivery/settings";
import { destinationEmailFromAgent } from "../../execution-plan";
import type { ToolExecutionOutcome, ToolHandlerContext } from "../../types";

function isResendConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM_EMAIL?.trim()
  );
}

export async function handleSendEmail(
  input: Record<string, unknown>,
  context: ToolHandlerContext
): Promise<ToolExecutionOutcome> {
  const to =
    (typeof input.to === "string" && input.to.trim()) ||
    (typeof input.recipient === "string" && input.recipient.trim()) ||
    destinationEmailFromAgent(context.agent.record);
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const message =
    (typeof input.message === "string" && input.message.trim()) ||
    (typeof input.body === "string" && input.body.trim()) ||
    "";

  const delivery = parseDeliverySettings(context.agent.record.safetySettings);
  if (shouldBlockExternalDeliveryTools(delivery.mode)) {
    return {
      executed: false,
      error: "This agent notifies you in Wave only. Email was not sent.",
      output: { blocked: "wave_only" },
    };
  }

  if (!to || !subject || !message) {
    return {
      executed: false,
      error: "send_email requires to, subject, and message.",
      output: { missingFields: true },
    };
  }

  if (!isResendConfigured()) {
    return {
      executed: false,
      error: "Email provider is not configured (RESEND_API_KEY / RESEND_FROM_EMAIL).",
      output: {
        to,
        subject,
        preview: message.slice(0, 240),
      },
    };
  }

  try {
    const result = await sendHtmlEmail({
      to,
      subject,
      html: `<p>${message.replace(/</g, "&lt;")}</p>`,
    });

    return {
      executed: true,
      output: {
        messageId: result.messageId,
        to,
        subject,
      },
    };
  } catch (err) {
    return {
      executed: false,
      error: err instanceof Error ? err.message : "Email send failed.",
      output: { to, subject },
    };
  }
}
