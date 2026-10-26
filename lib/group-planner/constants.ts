export const GROUP_TEMPLATE_SLUG = "group-decision-planner";

export const PLAN_GROUP_TOOL = "plan_group_outing";
export const REQUEST_RESERVATION_TOOL = "request_group_reservation";

export const PLAN_GROUP_ACTION = "group.plan";
export const REQUEST_RESERVATION_ACTION = "group.reservation";

export const RESERVATION_REVIEW_THRESHOLD_INR = 5_000;

export const FEEDBACK_REASONS = [
  "food",
  "cost",
  "location",
  "atmosphere",
  "accessibility",
  "timing",
  "other",
] as const;

export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export const SCORE_WEIGHTS = {
  taste: 0.4,
  budget: 0.2,
  travel: 0.15,
  diet: 0.15,
  fairness: 0.1,
} as const;

export const SAMPLE_GROUP_INTAKE = {
  groupName: "Saturday in Mumbai",
  city: "Mumbai",
  outingDate: "2026-11-07",
  startTime: "18:30",
  endTime: "22:00",
  maxBudgetInr: 8000,
  maxTravelMinutes: 40,
  participants: [
    {
      displayName: "Aisha",
      likes: ["A.R. Rahman", "vegetarian thali", "indie films"],
      preferredCuisines: "Indian vegetarian, coastal",
      dietary: "vegetarian",
      neighborhood: "Bandra",
    },
    {
      displayName: "Rohan",
      likes: ["Radiohead", "sci-fi movies", "ramen"],
      preferredCuisines: "Japanese, Korean",
      dietary: "",
      neighborhood: "Andheri",
    },
    {
      displayName: "Meera",
      likes: ["Zoya Akhtar films", "live jazz", "Goan seafood"],
      preferredCuisines: "seafood, Goan",
      dietary: "",
      neighborhood: "Colaba",
    },
    {
      displayName: "Kabir",
      likes: ["cricket", "biryani", "old Hindi film songs"],
      preferredCuisines: "Mughlai, kebabs",
      dietary: "halal preferred",
      neighborhood: "Dadar",
    },
  ],
};

export const GROUP_MISSION = {
  goal: "Combine individual tastes with Qloo evidence and hard constraints to recommend restaurants a group can agree on. Never invent restaurants, hours, prices, or confirmed reservations.",
  allowedTools: [PLAN_GROUP_TOOL, REQUEST_RESERVATION_TOOL],
  allowedActions: [PLAN_GROUP_ACTION, REQUEST_RESERVATION_ACTION],
};
