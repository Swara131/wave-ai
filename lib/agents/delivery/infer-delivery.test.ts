import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inferDeliveryModeFromText } from "./infer-delivery";

describe("inferDeliveryModeFromText", () => {
  it("infers email only when the user asks for email", () => {
    assert.equal(
      inferDeliveryModeFromText(
        "Create an agent that finds new AI news every morning and email me a short summary."
      ),
      "email"
    );
  });

  it("infers notification for notify me", () => {
    assert.equal(
      inferDeliveryModeFromText("Notify me when there is a critical approval."),
      "notification"
    );
  });

  it("infers Wave-only for notify on Wave, including a scheduled time", () => {
    assert.equal(
      inferDeliveryModeFromText("Notify me on Wave every morning at 9am."),
      "notification"
    );
    assert.equal(
      inferDeliveryModeFromText("Show in Wave at 14:00."),
      "notification"
    );
  });

  it("does not treat notify me by email as WhatsApp", () => {
    assert.equal(
      inferDeliveryModeFromText("Notify me by email when the digest is ready."),
      "email"
    );
  });

  it("infers email from by email", () => {
    assert.equal(
      inferDeliveryModeFromText(
        "Find the latest AI news every morning and send me a short summary by email."
      ),
      "email"
    );
  });

  it("does not assume email when the channel is unspecified", () => {
    assert.equal(
      inferDeliveryModeFromText("Find AI news every morning and give me a digest."),
      "notification"
    );
  });

  it("infers email plus WhatsApp only when both channels are named", () => {
    assert.equal(
      inferDeliveryModeFromText("Email me and also send WhatsApp."),
      "both"
    );
  });
});
