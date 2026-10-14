import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPendingDeliveryAnswer,
  needsPostRunDelivery,
  shouldBlockExternalDeliveryTools,
  shouldDeliverEmail,
  shouldDeliverInAppNotification,
  shouldDeliverWhatsApp,
} from "./settings";

describe("Wave-only delivery", () => {
  it("keeps notify-on-Wave when the user later provides an email address", () => {
    const next = applyPendingDeliveryAnswer(
      { mode: "notification", destinationEmail: null, destinationPhone: null },
      "email",
      "ada@example.com"
    );
    assert.equal(next.mode, "notification");
    assert.equal(next.destinationEmail, "ada@example.com");
    assert.equal(shouldDeliverInAppNotification(next.mode), true);
    assert.equal(shouldDeliverEmail(next.mode), false);
    assert.equal(shouldDeliverWhatsApp(next.mode), false);
  });

  it("keeps notify-on-Wave when the user later provides a WhatsApp number", () => {
    const next = applyPendingDeliveryAnswer(
      { mode: "notification", destinationEmail: null, destinationPhone: null },
      "whatsapp",
      "+919876543210"
    );
    assert.equal(next.mode, "notification");
    assert.equal(next.destinationPhone, "+919876543210");
    assert.equal(shouldDeliverWhatsApp(next.mode), false);
  });

  it("switches to Wave when the output choice is notification", () => {
    const next = applyPendingDeliveryAnswer(
      { mode: "email", destinationEmail: "ada@example.com", destinationPhone: null },
      "output_destination",
      "notification"
    );
    assert.equal(next.mode, "notification");
    assert.equal(shouldDeliverInAppNotification(next.mode), true);
    assert.equal(shouldDeliverEmail(next.mode), false);
  });

  it("delivers Wave in-app after scheduled and manual runs", () => {
    assert.equal(
      needsPostRunDelivery({ mode: "notification", emailedAlready: false, whatsappAlready: false }),
      true
    );
    assert.equal(
      needsPostRunDelivery({ mode: "notification", emailedAlready: true, whatsappAlready: true }),
      true
    );
    assert.equal(shouldBlockExternalDeliveryTools("notification"), true);
    assert.equal(shouldBlockExternalDeliveryTools("email"), false);
  });

  it("does not post-run email when Wave-only is selected", () => {
    assert.equal(shouldDeliverEmail("notification"), false);
    assert.equal(shouldDeliverWhatsApp("notification"), false);
    assert.equal(shouldDeliverInAppNotification("notification"), true);
  });
});
