import type { PolicyRuleDefinition } from "@/lib/gateway/policy/types";
import {
  BOOKING_REVIEW_THRESHOLD_INR,
  PLAN_ITINERARY_ACTION,
  PLAN_ITINERARY_TOOL,
  REQUEST_BOOKING_ACTION,
  REQUEST_BOOKING_TOOL,
} from "./constants";

function paise(amountInr: number): number {
  return Math.round(amountInr * 100);
}

export function travelProtectionPolicies(thresholdInr = BOOKING_REVIEW_THRESHOLD_INR): PolicyRuleDefinition[] {
  const reviewPaise = paise(thresholdInr);
  return [
    {
      id: "travel-itinerary-allow",
      name: "Travel itinerary planning",
      description: "Building a local itinerary from intake and taste data may proceed.",
      priority: 30,
      decision: "ALLOW",
      conditions: {
        toolName: PLAN_ITINERARY_TOOL,
        actionType: PLAN_ITINERARY_ACTION,
      },
    },
    {
      id: "travel-booking-unknown-review",
      name: "Unverified travel booking requires review",
      description: "Unknown prices, hours, or availability cannot be auto-booked.",
      priority: 8,
      decision: "REVIEW",
      conditions: {
        toolName: REQUEST_BOOKING_TOOL,
        actionType: REQUEST_BOOKING_ACTION,
        resourceType: "incomplete_booking",
      },
    },
    {
      id: "travel-booking-foreign-currency-review",
      name: "Non-INR travel booking requires review",
      description: "WAVE cannot compare foreign-currency prices to the INR threshold without a verified rate.",
      priority: 7,
      decision: "REVIEW",
      conditions: {
        toolName: REQUEST_BOOKING_TOOL,
        actionType: REQUEST_BOOKING_ACTION,
        resourceType: "foreign_currency_booking",
      },
    },
    {
      id: "travel-booking-multiday-review",
      name: "Multi-day travel bookings require approval",
      description: "Bookings that span multiple trip dates need a human reviewer.",
      priority: 6,
      decision: "REVIEW",
      conditions: {
        toolName: REQUEST_BOOKING_TOOL,
        actionType: REQUEST_BOOKING_ACTION,
        resourceType: "multiday_booking",
      },
    },
    {
      id: "travel-booking-overlap-block",
      name: "Overlapping travel booking blocked",
      description: "A booking that overlaps another pending or confirmed request is blocked.",
      priority: 4,
      decision: "BLOCK",
      conditions: {
        toolName: REQUEST_BOOKING_TOOL,
        actionType: REQUEST_BOOKING_ACTION,
        resourceType: "overlapping_booking",
      },
    },
    {
      id: "travel-booking-threshold-review",
      name: "Travel booking threshold",
      description: `Bookings of ₹${thresholdInr.toLocaleString("en-IN")} or more require human approval.`,
      priority: 11,
      decision: "REVIEW",
      conditions: {
        toolName: REQUEST_BOOKING_TOOL,
        actionType: REQUEST_BOOKING_ACTION,
        currency: "INR",
        amountMin: reviewPaise,
      },
    },
    {
      id: "travel-booking-pending-request",
      name: "Travel booking request without a provider",
      description:
        "No reservation or ticket provider is connected. WAVE may only store a pending request, never a confirmed booking.",
      priority: 20,
      decision: "ALLOW",
      conditions: {
        toolName: REQUEST_BOOKING_TOOL,
        actionType: REQUEST_BOOKING_ACTION,
        resourceType: "pending_request",
        currency: "INR",
        amountMax: reviewPaise - 1,
      },
    },
  ];
}
