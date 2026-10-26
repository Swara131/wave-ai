import type { PolicyRuleDefinition } from "@/lib/gateway/policy/types";
import {
  DEPOSIT_REVIEW_THRESHOLD_INR,
  PLAN_WEDDING_ACTION,
  PLAN_WEDDING_TOOL,
  REQUEST_DEPOSIT_ACTION,
  REQUEST_DEPOSIT_TOOL,
} from "./constants";

function paise(amountInr: number): number {
  return Math.round(amountInr * 100);
}

export function weddingProtectionPolicies(thresholdInr = DEPOSIT_REVIEW_THRESHOLD_INR): PolicyRuleDefinition[] {
  const reviewPaise = paise(thresholdInr);
  return [
    {
      id: "wedding-plan-allow",
      name: "Wedding planning",
      description: "Saving an event plan from stated preferences may proceed.",
      priority: 30,
      decision: "ALLOW",
      conditions: {
        toolName: PLAN_WEDDING_TOOL,
        actionType: PLAN_WEDDING_ACTION,
      },
    },
    {
      id: "wedding-deposit-unapproved-block",
      name: "Unapproved wedding vendor blocked",
      description: "Deposits cannot go to vendors who are not on the approved-vendor allowlist.",
      priority: 3,
      decision: "BLOCK",
      conditions: {
        toolName: REQUEST_DEPOSIT_TOOL,
        actionType: REQUEST_DEPOSIT_ACTION,
        resourceType: "unapproved_vendor",
      },
    },
    {
      id: "wedding-deposit-mismatch-block",
      name: "Mismatched wedding payment recipient blocked",
      description: "The payment recipient does not match the approved vendor record.",
      priority: 3,
      decision: "BLOCK",
      conditions: {
        toolName: REQUEST_DEPOSIT_TOOL,
        actionType: REQUEST_DEPOSIT_ACTION,
        resourceType: "mismatched_recipient",
      },
    },
    {
      id: "wedding-deposit-incomplete-review",
      name: "Incomplete wedding deposit requires review",
      description: "Missing quotes, purposes, or amounts cannot be auto-approved.",
      priority: 8,
      decision: "REVIEW",
      conditions: {
        toolName: REQUEST_DEPOSIT_TOOL,
        actionType: REQUEST_DEPOSIT_ACTION,
        resourceType: "incomplete_deposit",
      },
    },
    {
      id: "wedding-deposit-foreign-review",
      name: "Non-INR wedding deposit requires review",
      description: "WAVE cannot compare foreign-currency deposits to the INR threshold without a verified rate.",
      priority: 7,
      decision: "REVIEW",
      conditions: {
        toolName: REQUEST_DEPOSIT_TOOL,
        actionType: REQUEST_DEPOSIT_ACTION,
        resourceType: "foreign_currency_deposit",
      },
    },
    {
      id: "wedding-deposit-quote-changed-review",
      name: "Changed wedding quote requires a new review",
      description: "Editing a quotation after approval requires a fresh safety evaluation.",
      priority: 6,
      decision: "REVIEW",
      conditions: {
        toolName: REQUEST_DEPOSIT_TOOL,
        actionType: REQUEST_DEPOSIT_ACTION,
        resourceType: "quote_changed",
      },
    },
    {
      id: "wedding-deposit-threshold-review",
      name: "Wedding deposit threshold",
      description: `Deposits of ₹${thresholdInr.toLocaleString("en-IN")} or more require human approval.`,
      priority: 11,
      decision: "REVIEW",
      conditions: {
        toolName: REQUEST_DEPOSIT_TOOL,
        actionType: REQUEST_DEPOSIT_ACTION,
        currency: "INR",
        amountMin: reviewPaise,
      },
    },
    {
      id: "wedding-deposit-below-threshold",
      name: "Approved wedding deposit below threshold",
      description:
        "No vendor payment provider is connected. WAVE may store a pending payment request only, never mark a deposit as paid.",
      priority: 20,
      decision: "ALLOW",
      conditions: {
        toolName: REQUEST_DEPOSIT_TOOL,
        actionType: REQUEST_DEPOSIT_ACTION,
        resourceType: "approved_deposit",
        currency: "INR",
        amountMax: reviewPaise - 1,
      },
    },
  ];
}
