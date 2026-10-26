import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDecisionRunReport } from "./run-repository";

describe("parseDecisionRunReport", () => {
  it("does not treat another user's payload as verified just because an id is present", () => {
    const report = parseDecisionRunReport(
      {
        title: "Jio IPO Research & Decision Assistant",
        overall: "review",
        ipoStatus: "Open",
        ipoStatusVerified: false,
        agents: [{ id: "source_quality", name: "Sources", status: "completed" }],
      },
      "fallback"
    );
    assert.equal(report.ipoStatusVerified, false);
    assert.equal(report.agents[0]?.name, "Sources");
  });

  it("drops malformed agent entries instead of inventing New decision cards", () => {
    const report = parseDecisionRunReport(
      {
        agents: [{ foo: 1 }, { id: "risk_stance", name: "Risk stance", status: "failed", error: "timeout" }],
      },
      "Jio IPO Research & Decision Assistant"
    );
    assert.equal(report.agents.length, 1);
    assert.equal(report.agents[0]?.id, "risk_stance");
    assert.equal(report.title, "Jio IPO Research & Decision Assistant");
  });
});
