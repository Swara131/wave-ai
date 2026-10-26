import type { QlooTasteResult } from "@/lib/qloo/types";
import type { FeedbackReason } from "./constants";

export interface GroupParticipant {
  id: string;
  displayName: string;
  likes: string[];
  dislikes?: string;
  dietary?: string;
  accessibility?: string;
  preferredCuisines?: string;
  neighborhood?: string;
  maxTravelMinutes?: number;
  hardBudgetInr?: number;
}

export interface GroupIntake {
  groupName: string;
  city: string;
  outingDate: string;
  startTime: string;
  endTime?: string;
  maxBudgetInr: number;
  budgetCurrency: string;
  maxTravelMinutes: number;
  participants: GroupParticipant[];
  isDraft?: boolean;
}

export interface RestaurantCandidate {
  id: string;
  name: string;
  entityId?: string | null;
  cuisine?: string;
  address?: string;
  neighborhood?: string;
  estimatedCostPerPerson?: number | null;
  currency: string;
  distanceMinutes?: number | null;
  openingHours?: string | null;
  availability: "unverified";
  popularity?: number | null;
  affinity?: number | null;
  tags: string[];
  source: "qloo" | "stated_preferences";
  retrievedAt: string;
  unknownFields: string[];
}

export interface ParticipantMatch {
  participantId: string;
  displayName: string;
  score: number;
  qualitative: "strong" | "moderate" | "weak" | "poor";
  explanation: string;
}

export interface ScoredRestaurant {
  candidate: RestaurantCandidate;
  groupScore: number;
  fairnessScore: number;
  discoveryScore: number;
  matches: ParticipantMatch[];
  weakest: ParticipantMatch;
  hardPass: boolean;
  rejectReasons: string[];
  unknownFlags: string[];
  tradeoffs: string;
  explanation: string;
}

export interface GroupRecommendation {
  kind: "best_overall" | "fairest" | "discovery";
  title: string;
  scored: ScoredRestaurant;
}

export interface GroupFeedback {
  id: string;
  participantId: string;
  restaurantId: string;
  restaurantName: string;
  reason: FeedbackReason;
  note?: string;
  createdAt: string;
  undone?: boolean;
}

export interface GroupReservation {
  id: string;
  restaurantId: string;
  restaurantName: string;
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

export interface GroupItinerary {
  restaurantId: string;
  restaurantName: string;
  date: string;
  startTime: string;
  endTime?: string;
  estimatedDurationMinutes: number;
  meetingArea?: string;
  costPerPerson?: number | null;
  confirmations: string[];
  reservationStatus: GroupReservation["status"] | "not_requested";
  unresolved: string[];
}

export interface GroupSafetyRecord {
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

export interface GroupOuting {
  id: string;
  organizationId: string;
  userId: string;
  agentId: string;
  idempotencyKey: string;
  intake: GroupIntake;
  qloo: QlooTasteResult;
  candidates: RestaurantCandidate[];
  recommendations: GroupRecommendation[];
  feedback: GroupFeedback[];
  history: Array<{ at: string; summary: string }>;
  itinerary: GroupItinerary | null;
  reservation: GroupReservation | null;
  tooFewReason?: string | null;
  safety: GroupSafetyRecord;
  createdAt: string;
  updatedAt: string;
}
