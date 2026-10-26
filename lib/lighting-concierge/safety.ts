import { evaluateAction } from "@/lib/safety/gate";
import type { LoadedAgent } from "@/lib/agents/runtime/types";
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
import type { LightingQuote, LightingSafetyRecord } from "./types";

function mapDecision(decision: "ALLOW" | "REQUIRE_APPROVAL" | "BLOCK"): LightingSafetyRecord["decision"] {
  if (decision === "REQUIRE_APPROVAL") return "REVIEW";
  return decision;
}

export function evaluateLightingQuoteAction(params: {
  agent: LoadedAgent;
  quote: LightingQuote;
  jobId?: string;
}): ReturnType<typeof evaluateAction> & { record: LightingSafetyRecord } {
  const result = evaluateAction({
    agent: params.agent,
    tool: CREATE_QUOTE_TOOL,
    action: CREATE_QUOTE_ACTION,
    parameters: {
      amount: inrToPaise(params.quote.totalInr),
      currency: "INR",
      resourceType: params.quote.complete ? "complete_quote" : "incomplete_quote",
      quoteComplete: params.quote.complete,
      quoteFingerprint: params.quote.fingerprint,
      _lightingJobId: params.jobId ?? null,
    },
  });

  const decision = mapDecision(result.decision);
  const record: LightingSafetyRecord = {
    decision,
    actionType: CREATE_QUOTE_ACTION,
    toolName: CREATE_QUOTE_TOOL,
    estimatedAmountInr: params.quote.totalInr,
    policyRules: result.matchedPolicies.map((policy) => policy.name),
    reason: result.reason,
    approvalStatus:
      decision === "ALLOW" ? "not_required" : decision === "BLOCK" ? "blocked" : "pending",
    timestamp: new Date().toISOString(),
    executionStatus:
      decision === "ALLOW" ? "executed" : decision === "BLOCK" ? "blocked" : "awaiting_approval",
  };

  return Object.assign(result, { record });
}

export function evaluateLightingAddressAction(params: {
  agent: LoadedAgent;
  jobId: string;
  address: string;
}): ReturnType<typeof evaluateAction> {
  return evaluateAction({
    agent: params.agent,
    tool: VERIFY_ADDRESS_TOOL,
    action: VERIFY_ADDRESS_ACTION,
    parameters: {
      address: params.address,
      resourceType: "unverified_address",
      _lightingJobId: params.jobId,
    },
  });
}

export function evaluateLightingVisitAction(params: {
  agent: LoadedAgent;
  jobId: string;
  addressStatus: "missing" | "unverified" | "pending_review" | "verified" | "rejected";
  quoteTotalInr: number;
}): ReturnType<typeof evaluateAction> {
  const resourceType =
    params.addressStatus === "missing"
      ? "missing_address"
      : params.addressStatus === "verified"
        ? "verified_address"
        : "unverified_address";
  return evaluateAction({
    agent: params.agent,
    tool: REQUEST_VISIT_TOOL,
    action: REQUEST_VISIT_ACTION,
    parameters: {
      amount: inrToPaise(params.quoteTotalInr),
      currency: "INR",
      resourceType,
      _lightingJobId: params.jobId,
    },
  });
}

export { QUOTE_REVIEW_THRESHOLD_INR };
