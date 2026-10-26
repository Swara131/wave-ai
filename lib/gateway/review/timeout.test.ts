import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionProposalRow } from "@/lib/gateway/proposals/repository";
import {
  applyReviewTimeoutIfExpired,
  effectiveReviewDeadline,
  isReviewDeadlineExpired,
} from "./timeout";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROPOSAL_ID = "44444444-4444-4444-8444-444444444444";

function buildReviewRow(overrides: Partial<ActionProposalRow> = {}): ActionProposalRow {
  const reviewExpiresAt =
    overrides.review_expires_at ??
    new Date(Date.now() - 60_000).toISOString();

  return {
    id: PROPOSAL_ID,
    organization_id: ORG,
    agent_id: "refund-agent-01",
    tool_name: "issue_refund",
    action_type: "financial.refund",
    action_payload: { amount: 100 },
    action_hash: "hash-abc",
    plain_english_summary: null,
    risk_level: "medium",
    risk_score: 50,
    risk_reasons: { matchedPolicies: [] },
    policy_decision: "review",
    status: "review_required",
    requested_by: null,
    idempotency_key: null,
    created_at: new Date(Date.now() - 3_600_000).toISOString(),
    updated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    review_expires_at: reviewExpiresAt,
    decided_at: new Date(Date.now() - 3_600_000).toISOString(),
    executed_at: null,
    ...overrides,
  };
}

describe("review timeout lifecycle", () => {
  it("does nothing when review deadline has not passed", async () => {
    const row = buildReviewRow({
      review_expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    const result = await applyReviewTimeoutIfExpired({} as SupabaseClient, row, {
      timeoutBehavior: "auto_deny",
    });

    assert.equal(result.outcome, "none");
    assert.equal(result.row.status, "review_required");
  });

  it("auto-denies expired review proposals", async () => {
    const row = buildReviewRow();
    let deniedRow: ActionProposalRow | null = null;
    const auditEvents: string[] = [];

    const result = await applyReviewTimeoutIfExpired({} as SupabaseClient, row, {
      timeoutBehavior: "auto_deny",
      deps: {
        autoDeny: async () => {
          deniedRow = { ...row, status: "expired", decided_at: new Date().toISOString() };
          return deniedRow;
        },
        insertDecision: async () => {},
        recordAudit: (_supabase, params) => {
          auditEvents.push(params.event);
        },
        getProposal: async () => deniedRow,
      },
    });

    assert.equal(result.outcome, "auto_denied");
    assert.equal(result.row.status, "expired");
    assert.ok(auditEvents.includes("review.expired"));
    assert.ok(auditEvents.includes("review.auto_denied"));
  });

  it("escalates expired review when configured", async () => {
    const row = buildReviewRow();
    const newDeadline = new Date(Date.now() + 3_600_000).toISOString();
    const auditEvents: string[] = [];

    const result = await applyReviewTimeoutIfExpired({} as SupabaseClient, row, {
      timeoutBehavior: "escalate",
      escalationMaxLevel: 3,
      deadlineHours: 4,
      deps: {
        escalate: async () => ({
          ...row,
          review_expires_at: newDeadline,
          risk_reasons: {
            matchedPolicies: [],
            reviewEscalation: {
              level: 1,
              escalatedAt: new Date().toISOString(),
              priorDeadline: row.review_expires_at!,
              newDeadline,
              reason: "Review deadline passed without human action (escalation level 1).",
            },
          },
        }),
        recordAudit: (_supabase, params) => {
          auditEvents.push(params.event);
        },
        getProposal: async () => row,
        autoDeny: async () => null,
        insertDecision: async () => {},
      },
    });

    assert.equal(result.outcome, "escalated");
    assert.equal(result.row.review_expires_at, newDeadline);
    assert.ok(auditEvents.includes("review.expired"));
    assert.ok(auditEvents.includes("review.escalated"));
  });

  it("auto-denies after max escalation level even in escalate mode", async () => {
    const row = buildReviewRow({
      risk_reasons: {
        matchedPolicies: [],
        reviewEscalation: { level: 3, escalatedAt: "t", priorDeadline: "t", newDeadline: "t", reason: "x" },
      },
    });

    const result = await applyReviewTimeoutIfExpired({} as SupabaseClient, row, {
      timeoutBehavior: "escalate",
      escalationMaxLevel: 3,
      deps: {
        autoDeny: async () => ({ ...row, status: "expired" }),
        insertDecision: async () => {},
        recordAudit: () => {},
        getProposal: async () => ({ ...row, status: "expired" as const }),
      },
    });

    assert.equal(result.outcome, "auto_denied");
    assert.equal(result.row.status, "expired");
  });

  it("never auto-approves on timeout", async () => {
    const row = buildReviewRow();
    const result = await applyReviewTimeoutIfExpired({} as SupabaseClient, row, {
      timeoutBehavior: "auto_deny",
      deps: {
        autoDeny: async () => ({ ...row, status: "rejected" }),
        insertDecision: async () => {},
        recordAudit: () => {},
        getProposal: async () => ({ ...row, status: "rejected" }),
      },
    });

    assert.notEqual(result.row.status, "approved");
    assert.notEqual(result.row.status, "allowed");
  });

  it("uses review_expires_at as effective deadline", () => {
    const row = buildReviewRow({
      review_expires_at: "2026-07-01T12:00:00.000Z",
      expires_at: "2026-07-02T12:00:00.000Z",
    });
    assert.equal(effectiveReviewDeadline(row), "2026-07-01T12:00:00.000Z");
    assert.equal(
      isReviewDeadlineExpired(row, new Date("2026-07-01T13:00:00.000Z")),
      true
    );
  });
});

describe("review timeout race safety", () => {
  it("returns none when auto-deny loses race to human approval", async () => {
    const row = buildReviewRow();
    let callCount = 0;

    const result = await applyReviewTimeoutIfExpired({} as SupabaseClient, row, {
      timeoutBehavior: "auto_deny",
      deps: {
        autoDeny: async () => {
          callCount += 1;
          return null;
        },
        getProposal: async () => ({
          ...row,
          status: "approved",
          decided_at: new Date().toISOString(),
        }),
        insertDecision: async () => {
          throw new Error("should not insert when race lost");
        },
        recordAudit: () => {},
      },
    });

    assert.equal(callCount, 1);
    assert.equal(result.outcome, "none");
    assert.equal(result.row.status, "approved");
  });

  it("does not auto-deny agent activation proposals", async () => {
    const row = buildReviewRow({
      tool_name: "activate_agent",
      action_type: "agent.activate",
      review_expires_at: new Date(Date.now() - 60_000).toISOString(),
    });

    const result = await applyReviewTimeoutIfExpired({} as SupabaseClient, row, {
      timeoutBehavior: "auto_deny",
      deps: {
        autoDeny: async () => {
          throw new Error("activation proposals must stay pending");
        },
        insertDecision: async () => {
          throw new Error("should not insert");
        },
        recordAudit: () => {
          throw new Error("should not audit expire");
        },
      },
    });

    assert.equal(result.outcome, "none");
    assert.equal(result.row.status, "review_required");
  });
});
