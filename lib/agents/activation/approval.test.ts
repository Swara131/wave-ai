import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAgentActivationApproved,
  isAgentActivationProposal,
} from "./approval";

describe("agent activation approval", () => {
  it("identifies activation proposals", () => {
    assert.equal(
      isAgentActivationProposal({ tool_name: "activate_agent", action_type: "agent.activate" }),
      true
    );
    assert.equal(
      isAgentActivationProposal({ tool_name: "send_email", action_type: "email.send" }),
      false
    );
  });

  it("treats only an approved agent as unblocked", () => {
    assert.equal(isAgentActivationApproved({ safetySettings: {} }), false);
    assert.equal(
      isAgentActivationApproved({
        safetySettings: { activation: { status: "pending" } },
      }),
      false
    );
    assert.equal(
      isAgentActivationApproved({
        safetySettings: { activation: { status: "approved" } },
      }),
      true
    );
  });
});
