import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PendingApproval } from "@/lib/approval-types";
import {
  approvalAgentSlug,
  continueHrefAfterApproval,
} from "./continue-after-approval";

function approval(partial: Partial<PendingApproval>): PendingApproval {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Activate agent",
    agentId: "Alert Handler Agent",
    riskSeverity: "medium",
    priority: "p3",
    aiExplanation: "",
    businessJustification: "",
    affectedSystems: [],
    affectedUsers: [],
    complianceImpact: "",
    recommendedAction: "",
    confidenceScore: 55,
    timeline: [],
    history: [],
    submittedAt: new Date().toISOString(),
    slaDeadline: new Date().toISOString(),
    assignee: "Unassigned",
    requester: "alert-handler",
    source: "gateway",
    ...partial,
  };
}

describe("continueHrefAfterApproval", () => {
  it("uses the gateway slug, not the display name", () => {
    assert.equal(approvalAgentSlug(approval({})), "alert-handler");
    assert.equal(
      continueHrefAfterApproval(
        approval({ toolName: "activate_agent", actionType: "agent.activate" })
      ),
      "/agents/alert-handler?run=1"
    );
  });

  it("sends lighting reviews back to the lighting workspace", () => {
    assert.equal(
      continueHrefAfterApproval(
        approval({
          requester: "lighting-concierge",
          toolName: "create_service_quote",
          actionType: "service.quote",
        })
      ),
      "/agents/lighting-concierge/lighting"
    );
  });

  it("sends travel reviews back to the travel workspace", () => {
    assert.equal(
      continueHrefAfterApproval(
        approval({
          requester: "travel-companion",
          toolName: "request_travel_booking",
          actionType: "travel.booking_request",
        })
      ),
      "/agents/travel-companion/travel"
    );
  });

  it("sends wedding reviews back to the wedding workspace", () => {
    assert.equal(
      continueHrefAfterApproval(
        approval({
          requester: "wedding-celebration-planner",
          toolName: "request_wedding_deposit",
          actionType: "wedding.deposit",
        })
      ),
      "/agents/wedding-celebration-planner/wedding"
    );
  });

  it("sends group reviews back to the group workspace", () => {
    assert.equal(
      continueHrefAfterApproval(
        approval({
          requester: "group-decision-planner",
          toolName: "request_group_reservation",
          actionType: "group.reservation",
        })
      ),
      "/agents/group-decision-planner/group"
    );
  });

  it("opens the runs tab when a paused run already resumed", () => {
    assert.equal(
      continueHrefAfterApproval(
        approval({ toolName: "send_email", actionType: "communication.email" }),
        { resumed: true }
      ),
      "/agents/alert-handler?tab=runs"
    );
  });
});
