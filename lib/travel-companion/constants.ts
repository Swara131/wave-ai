export const TRAVEL_TEMPLATE_SLUG = "travel-companion";

export const PLAN_ITINERARY_TOOL = "plan_travel_itinerary";
export const REQUEST_BOOKING_TOOL = "request_travel_booking";

export const PLAN_ITINERARY_ACTION = "travel.itinerary";
export const REQUEST_BOOKING_ACTION = "travel.booking_request";

export const BOOKING_REVIEW_THRESHOLD_INR = 5_000;

export const INTERESTS = [
  "food",
  "music",
  "art",
  "museums",
  "nature",
  "shopping",
  "nightlife",
  "history",
  "adventure",
  "family",
] as const;

export const PACES = ["relaxed", "balanced", "packed"] as const;

export const TRANSPORTS = ["walk", "transit", "taxi", "mix", "unspecified"] as const;

export const DAY_PARTS = ["morning", "afternoon", "evening"] as const;

export type Interest = (typeof INTERESTS)[number];
export type Pace = (typeof PACES)[number];
export type Transport = (typeof TRANSPORTS)[number];
export type DayPart = (typeof DAY_PARTS)[number];

export const SAMPLE_TRAVEL_INTAKE = {
  destination: "Jaipur",
  startDate: "2026-11-10",
  endDate: "2026-11-12",
  travelers: 2,
  budgetAmount: 18000,
  budgetCurrency: "INR",
  interests: ["food", "history", "art"] as Interest[],
  pace: "balanced" as Pace,
  startingArea: "Old City",
  favoriteCuisines: "Rajasthani, vegetarian street food",
  culturalInterests: "crafts, palaces, folk music",
};

export const TRAVEL_MISSION = {
  goal: "Plan taste-informed local itineraries and create pending booking requests. Never invent venues, prices, opening hours, or confirmed reservations.",
  allowedTools: [PLAN_ITINERARY_TOOL, REQUEST_BOOKING_TOOL],
  allowedActions: [PLAN_ITINERARY_ACTION, REQUEST_BOOKING_ACTION],
};
