import type { PolicyRuleDefinition } from "@/lib/gateway/policy/types";
import {
  PLAN_GROUP_ACTION,
  PLAN_GROUP_TOOL,
  REQUEST_RESERVATION_ACTION,
  REQUEST_RESERVATION_TOOL,
  RESERVATION_REVIEW_THRESHOLD_INR,
} from "./constants";

function paise(amountInr: number): number {
  return Math.round(amountInr * 100);
}

export function groupProtectionPolicies(thresholdInr = RESERVATION_REVIEW_THRESHOLD_INR): PolicyRuleDefinition[] {
  const reviewPaise = paise(thresholdInr);
  return [
    {
      id: "group-plan-allow",
      name: "Group outing planning",
      description: "Generating restaurant recommendations does not create a booking.",
      priority: 30,
      decision: "ALLOW",
      conditions: {
        toolName: PLAN_GROUP_TOOL,
        actionType: PLAN_GROUP_ACTION,
      },
    },
    {
      id: "group-reservation-duplicate-block",
      name: "Duplicate group reservation blocked",
      description: "An open reservation request already exists for this outing.",
      priority: 3,
      decision: "BLOCK",
      conditions: {
        toolName: REQUEST_RESERVATION_TOOL,
        actionType: REQUEST_RESERVATION_ACTION,
        resourceType: "duplicate_reservation",
      },
    },
    {
      id: "group-reservation-incomplete-review",
      name: "Incomplete group reservation requires review",
      description: "Missing restaurant, time, party size, or unverified hours cannot be auto-booked.",
      priority: 8,
      decision: "REVIEW",
      conditions: {
        toolName: REQUEST_RESERVATION_TOOL,
        actionType: REQUEST_RESERVATION_ACTION,
        resourceType: "incomplete_reservation",
      },
    },
    {
      id: "group-reservation-foreign-review",
      name: "Non-INR group reservation requires review",
      description: "WAVE cannot compare foreign-currency totals to the INR threshold without a verified rate.",
      priority: 7,
      decision: "REVIEW",
      conditions: {
        toolName: REQUEST_RESERVATION_TOOL,
        actionType: REQUEST_RESERVATION_ACTION,
        resourceType: "foreign_currency_reservation",
      },
    },
    {
      id: "group-reservation-threshold-review",
      name: "Group reservation threshold",
      description: `Paid outing requests of ₹${thresholdInr.toLocaleString("en-IN")} or more require human approval.`,
      priority: 11,
      decision: "REVIEW",
      conditions: {
        toolName: REQUEST_RESERVATION_TOOL,
        actionType: REQUEST_RESERVATION_ACTION,
        currency: "INR",
        amountMin: reviewPaise,
      },
    },
    {
      id: "group-reservation-pending",
      name: "Group reservation without a booking provider",
      description:
        "No restaurant booking provider is connected. WAVE may store a pending confirmation request only, never a confirmed table.",
      priority: 20,
      decision: "ALLOW",
      conditions: {
        toolName: REQUEST_RESERVATION_TOOL,
        actionType: REQUEST_RESERVATION_ACTION,
        resourceType: "pending_confirmation",
        currency: "INR",
        amountMax: reviewPaise - 1,
      },
    },
  ];
}
