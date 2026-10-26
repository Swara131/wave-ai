export const WEDDING_TEMPLATE_SLUG = "wedding-celebration-planner";

export const PLAN_WEDDING_TOOL = "plan_wedding_event";
export const REQUEST_DEPOSIT_TOOL = "request_wedding_deposit";

export const PLAN_WEDDING_ACTION = "wedding.plan";
export const REQUEST_DEPOSIT_ACTION = "wedding.deposit";

export const DEPOSIT_REVIEW_THRESHOLD_INR = 10_000;

export const EVENT_TYPES = [
  "wedding",
  "engagement",
  "reception",
  "anniversary",
  "birthday",
  "other",
] as const;

export const VENUE_STYLES = [
  "traditional",
  "modern",
  "garden",
  "luxury",
  "intimate",
  "minimalist",
  "other",
] as const;

export const VENDOR_CATEGORIES = [
  "venue",
  "caterer",
  "decorator",
  "photographer",
  "videographer",
  "music",
  "stylist",
  "other",
] as const;

export const BUDGET_CATEGORIES = [
  "venue",
  "catering",
  "decor",
  "photography",
  "music",
  "clothing",
  "invitations",
  "transport",
  "accommodation",
  "contingency",
] as const;

export const INVITE_TONES = ["traditional", "elegant", "modern", "warm", "playful"] as const;

export type EventType = (typeof EVENT_TYPES)[number];
export type VenueStyle = (typeof VENUE_STYLES)[number];
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];
export type InviteTone = (typeof INVITE_TONES)[number];

export const SAMPLE_WEDDING_INTAKE = {
  eventName: "Ananya & Rohan's wedding",
  eventType: "wedding" as EventType,
  startDate: "2026-12-12",
  endDate: "2026-12-13",
  location: "Jaipur",
  guestCount: 180,
  budgetAmount: 850000,
  budgetCurrency: "INR",
  couplePreferences: "Garden venue, vegetarian Gujarati-Rajasthani food, live folk and a small DJ set.",
  venueStyle: "garden" as VenueStyle,
  cuisine: "Vegetarian thali, live chaat, no onion-garlic at the ceremony lunch",
  music: "Folk ensemble for pheras, DJ after dinner",
  decorPalette: "Ivory, marigold, and sage",
  photographyStyle: "Candid documentary with a few posed family portraits",
  traditions: "Gujarati welcome, Rajasthani folk for the sangeet",
};

export const WEDDING_MISSION = {
  goal: "Plan weddings and celebrations from stated preferences, compare user-entered vendors, draft invitations, and create pending deposit requests. Never invent vendors, quotes, availability, or paid status. Never use Qloo.",
  allowedTools: [PLAN_WEDDING_TOOL, REQUEST_DEPOSIT_TOOL],
  allowedActions: [PLAN_WEDDING_ACTION, REQUEST_DEPOSIT_ACTION],
};
