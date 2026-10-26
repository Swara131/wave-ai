import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executionStatusFromSafety } from "./execution-record";

describe("executionStatusFromSafety", () => {
  it("maps BLOCK to blocked and REVIEW to needs_approval", () => {
    assert.equal(executionStatusFromSafety("BLOCK"), "blocked");
    assert.equal(executionStatusFromSafety("REVIEW"), "needs_approval");
    assert.equal(executionStatusFromSafety("ALLOW"), "completed");
  });
});
