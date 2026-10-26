import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidDecisionRunId, shouldReuseExistingRun } from "./run-id";

describe("decision run authorization helpers", () => {
  it("rejects guessed non-uuid run ids before a database lookup", () => {
    assert.equal(isValidDecisionRunId("latest"), false);
    assert.equal(isValidDecisionRunId(""), false);
    assert.equal(isValidDecisionRunId("not-a-uuid"), false);
  });

  it("accepts a uuid v4-shaped run id", () => {
    assert.equal(isValidDecisionRunId("3fa85f64-5717-4562-b3fc-2c963f66afa6"), true);
  });

  it("reuses a duplicate live click when the run is still running or completed", () => {
    assert.equal(shouldReuseExistingRun("running"), true);
    assert.equal(shouldReuseExistingRun("completed"), true);
    assert.equal(shouldReuseExistingRun("failed"), false);
  });
});
