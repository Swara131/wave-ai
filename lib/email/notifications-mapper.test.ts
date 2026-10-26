import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapNotificationRow, notificationOpenHref } from "./notifications-mapper";
import type { NotificationRow } from "./repository";

function sampleRow(partial: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: "n1",
    organization_id: "org",
    user_id: "user",
    approval_request_id: null,
    risk_analysis_id: null,
    risk_title: "Custom Agent result",
    risk_id: "run-1",
    severity: "low",
    status: "unread",
    channel: "in_app",
    delivery_status: "delivered",
    recipient: "Swara",
    recipient_email: null,
    subject: "Wave Agent Result — Custom Agent",
    preview: "Short clip",
    retry_count: 0,
    max_retries: 3,
    template_type: "agent_result",
    template_payload: {
      agentName: "Custom Agent",
      agentSlug: "custom-agent-2",
      summary: "Full agent summary from the run.",
      recipientName: "Swara",
      runMode: "scheduled",
      runAt: "2026-10-23T09:24:00.000Z",
    },
    provider_message_id: null,
    last_error: null,
    sent_at: "2026-10-23T09:24:00.000Z",
    created_at: "2026-10-23T09:24:00.000Z",
    ...partial,
  };
}

describe("notificationOpenHref", () => {
  it("opens the saved run page when a runId is present", () => {
    assert.equal(
      notificationOpenHref(
        sampleRow({
          template_payload: {
            agentName: "Lighting Concierge",
            agentSlug: "lighting-concierge",
            summary: "Plan ready",
            recipientName: "Swara",
            runMode: "manual",
            runAt: "2026-10-23T09:24:00.000Z",
            runId: "run-abc",
            executionStatus: "completed",
            templateName: "Lighting Concierge",
          },
        })
      ),
      "/runs/run-abc"
    );
  });

  it("opens the agent result page for in-app agent results without a runId", () => {
    assert.equal(
      notificationOpenHref(sampleRow()),
      "/agents/custom-agent-2/result"
    );
  });

  it("does not invent a result URL when the payload has no agent", () => {
    assert.equal(
      notificationOpenHref(
        sampleRow({
          template_type: "agent_result",
          template_payload: {
            agentName: "Custom Agent",
            agentSlug: "",
            summary: "x",
            recipientName: "Swara",
            runMode: "scheduled",
            runAt: "2026-10-23T09:24:00.000Z",
          },
        })
      ),
      null
    );
  });
});

describe("mapNotificationRow", () => {
  it("keeps the full summary so the preview is not an empty clip", () => {
    const item = mapNotificationRow(sampleRow());
    assert.equal(item.preview, "Full agent summary from the run.");
    assert.equal(item.openHref, "/agents/custom-agent-2/result");
    assert.equal(item.channel, "in_app");
  });
});
