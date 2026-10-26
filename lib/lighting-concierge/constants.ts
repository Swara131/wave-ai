export const LIGHTING_TEMPLATE_SLUG = "lighting-concierge";

export const QUOTE_REVIEW_THRESHOLD_INR = 5_000;

export const CREATE_QUOTE_TOOL = "create_service_quote";
export const VERIFY_ADDRESS_TOOL = "verify_service_address";
export const REQUEST_VISIT_TOOL = "request_electrician_visit";

export const CREATE_QUOTE_ACTION = "service.quote";
export const VERIFY_ADDRESS_ACTION = "service.address_verify";
export const REQUEST_VISIT_ACTION = "service.appointment_request";

export const ROOM_TYPES = [
  "living_room",
  "bedroom",
  "kitchen",
  "bathroom",
  "office",
  "outdoor",
  "other",
] as const;

export const STYLE_OPTIONS = [
  "modern",
  "minimalist",
  "classic",
  "industrial",
  "traditional",
  "unsure",
] as const;

export const LIGHTING_PREFERENCES = ["warm", "neutral", "cool", "unsure"] as const;

export const JOB_KINDS = ["new_installation", "replacement", "consultation"] as const;

export type RoomType = (typeof ROOM_TYPES)[number];
export type StyleOption = (typeof STYLE_OPTIONS)[number];
export type LightingPreference = (typeof LIGHTING_PREFERENCES)[number];
export type JobKind = (typeof JOB_KINDS)[number];
