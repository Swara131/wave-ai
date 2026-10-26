import type { QlooTasteResult } from "@/lib/qloo/types";
import type { DayPart, Interest, Pace, Transport } from "./constants";

export interface TravelIntake {
  destination: string;
  startDate: string;
  endDate: string;
  travelers: number;
  budgetAmount: number;
  budgetCurrency: string;
  interests: Interest[];
  pace: Pace;
  startingArea?: string;
  favoriteCuisines?: string;
  culturalInterests?: string;
  dietaryNeeds?: string;
  accessibilityNeeds?: string;
  preferredTransport?: Transport;
  accommodation?: string;
  existingReservations?: string;
  avoid?: string;
  dayStartTime?: string;
  dayEndTime?: string;
}

export interface TravelActivity {
  id: string;
  dayIndex: number;
  dayDate: string;
  part: DayPart;
  startTime: string;
  endTime: string;
  title: string;
  category: Interest | "break" | "other";
  location: string;
  durationMinutes: number;
  estimatedCostPerPerson: number | null;
  costVerified: boolean;
  reason: string;
  qlooInformed: boolean;
  qlooEvidence?: string;
  source: "qloo" | "stated_preferences";
  availability: "verified" | "unavailable" | "unknown";
  hoursVerified: boolean;
  travelTimeVerified: boolean;
  bookingRequired: boolean;
  flags: string[];
}

export interface TravelDay {
  date: string;
  index: number;
  activities: TravelActivity[];
}

export interface TravelItinerary {
  days: TravelDay[];
  plannedSpendInr: number | null;
  remainingBudgetInr: number | null;
  currency: string;
  conflicts: string[];
  missingInformation: string[];
  generatedAt: string;
}

export interface TravelBooking {
  id: string;
  activityId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  partySize: number;
  amount: number | null;
  currency: string;
  status: "pending_confirmation" | "awaiting_approval" | "blocked" | "rejected";
  provider: "none";
  reference: null;
  note: string;
  proposalId?: string | null;
  idempotencyKey: string;
  createdAt: string;
}

export interface TravelSafetyRecord {
  decision: "ALLOW" | "REVIEW" | "BLOCK";
  actionType: string;
  toolName: string;
  estimatedAmountInr: number | null;
  policyRules: string[];
  reason: string;
  approvalStatus: "not_required" | "pending" | "approved" | "rejected" | "blocked";
  proposalId?: string | null;
  timestamp: string;
  executionStatus: "not_started" | "awaiting_approval" | "executed" | "blocked" | "rejected";
}

export interface TravelTrip {
  id: string;
  organizationId: string;
  userId: string;
  agentId: string;
  idempotencyKey: string;
  intake: TravelIntake;
  itinerary: TravelItinerary;
  qloo: QlooTasteResult;
  safety: TravelSafetyRecord;
  bookings: TravelBooking[];
  createdAt: string;
  updatedAt: string;
}
