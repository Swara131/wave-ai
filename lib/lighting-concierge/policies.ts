import type { PolicyRuleDefinition } from "@/lib/gateway/policy/types";
import {
  CREATE_QUOTE_ACTION,
  CREATE_QUOTE_TOOL,
  QUOTE_REVIEW_THRESHOLD_INR,
  REQUEST_VISIT_ACTION,
  REQUEST_VISIT_TOOL,
  VERIFY_ADDRESS_ACTION,
  VERIFY_ADDRESS_TOOL,
} from "./constants";
import { inrToPaise } from "./pricing";

export function lightingQuoteThresholdPaise(thresholdInr = QUOTE_REVIEW_THRESHOLD_INR): number {
  return inrToPaise(thresholdInr);
}

export function lightingProtectionPolicies(
  thresholdInr = QUOTE_REVIEW_THRESHOLD_INR
): PolicyRuleDefinition[] {
  const reviewPaise = lightingQuoteThresholdPaise(thresholdInr);
  const allowMax = reviewPaise - 1;
  return [
    {
      id: "lighting-quote-incomplete-review",
      name: "Incomplete lighting quote requires review",
      description: "An uncertain or incomplete quote cannot be auto-approved.",
      priority: 8,
      decision: "REVIEW",
      conditions: {
        toolName: CREATE_QUOTE_TOOL,
        actionType: CREATE_QUOTE_ACTION,
        resourceType: "incomplete_quote",
      },
    },
    {
      id: "lighting-quote-allow-below-threshold",
      name: "Small complete lighting quote auto-allow",
      description: `Complete quotes below ₹${thresholdInr.toLocaleString("en-IN")} may be allowed when calculated from configured rates.`,
      priority: 16,
      decision: "ALLOW",
      conditions: {
        toolName: CREATE_QUOTE_TOOL,
        actionType: CREATE_QUOTE_ACTION,
        currency: "INR",
        amountMax: allowMax,
        resourceType: "complete_quote",
      },
    },
    {
      id: "lighting-quote-review-threshold",
      name: "Lighting quote threshold",
      description: `Quotes of ₹${thresholdInr.toLocaleString("en-IN")} or more require human approval.`,
      priority: 11,
      decision: "REVIEW",
      conditions: {
        toolName: CREATE_QUOTE_TOOL,
        actionType: CREATE_QUOTE_ACTION,
        currency: "INR",
        amountMin: reviewPaise,
      },
    },
    {
      id: "lighting-address-missing-block",
      name: "Installation needs an address",
      description: "An installation visit cannot be requested without a service address.",
      priority: 4,
      decision: "BLOCK",
      conditions: {
        toolName: REQUEST_VISIT_TOOL,
        actionType: REQUEST_VISIT_ACTION,
        resourceType: "missing_address",
      },
    },
    {
      id: "lighting-address-unverified-review",
      name: "Unverified address requires review",
      description: "A typed address is not verification. A reviewer must confirm it.",
      priority: 7,
      decision: "REVIEW",
      conditions: {
        toolName: REQUEST_VISIT_TOOL,
        actionType: REQUEST_VISIT_ACTION,
        resourceType: "unverified_address",
      },
    },
    {
      id: "lighting-address-verify-review",
      name: "Address verification is manual",
      description: "WAVE has no address-verification provider. A human reviewer must confirm the address.",
      priority: 9,
      decision: "REVIEW",
      conditions: {
        toolName: VERIFY_ADDRESS_TOOL,
        actionType: VERIFY_ADDRESS_ACTION,
      },
    },
    {
      id: "lighting-visit-allow-verified",
      name: "Verified address appointment request",
      description:
        "A request may be stored as pending confirmation after address verification. This is not a confirmed booking.",
      priority: 40,
      decision: "ALLOW",
      conditions: {
        toolName: REQUEST_VISIT_TOOL,
        actionType: REQUEST_VISIT_ACTION,
        resourceType: "verified_address",
      },
    },
  ];
}
