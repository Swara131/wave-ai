import type { QlooTasteResult } from "@/lib/qloo/types";
import type {
  JobKind,
  LightingPreference,
  RoomType,
  StyleOption,
} from "./constants";

export interface LightingRates {
  labourPerHourInr: number;
  ambientFixtureInr: number;
  taskFixtureInr: number;
  accentFixtureInr: number;
  travelInr: number;
  currency: "INR";
  source: "provider_configured";
  updatedAt: string;
}

export interface LightingIntake {
  customerName: string;
  contactEmail?: string;
  contactPhone?: string;
  roomType: RoomType;
  roomPurpose: string;
  preferredStyle: StyleOption;
  lightingPreference: LightingPreference;
  budgetInr: number;
  serviceAddress: string;
  jobKind: JobKind;
  roomDimensions?: string;
  ceilingHeight?: string;
  existingFixtures?: string;
  lightsNeeded?: number;
  preferredAppointmentAt?: string;
  additionalPreferences?: string;
}

export interface QuoteLine {
  id: string;
  label: string;
  quantity: number;
  unitInr: number;
  totalInr: number;
  assumption: string;
}

export interface LightingQuote {
  currency: "INR";
  lines: QuoteLine[];
  materialsInr: number;
  labourInr: number;
  travelInr: number;
  totalInr: number;
  complete: boolean;
  fingerprint: string;
  assumptions: string[];
  binding: false;
  status: "draft" | "approved" | "rejected" | "superseded";
  ratesSource: "provider_configured";
}

export interface LightingPlan {
  styleAndAmbience: string;
  colourTemperatureKelvin: {
    range: string;
    explanation: string;
    source: "general_lighting_guidance";
  };
  layers: Array<{ name: string; recommendation: string }>;
  fixtures: string[];
  energy: string;
  openQuestions: string[];
  nextStep: "revise_plan" | "request_consultation" | "book_electrician_visit";
}

export type AddressVerificationStatus =
  | "missing"
  | "unverified"
  | "pending_review"
  | "verified"
  | "rejected";

export interface AddressVerification {
  status: AddressVerificationStatus;
  address: string;
  method: "manual_reviewer";
  proposalId?: string | null;
  verifiedAt?: string | null;
  verifiedBy?: string | null;
  note?: string | null;
}

export interface LightingSafetyRecord {
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

export interface LightingAppointment {
  status: "none" | "blocked" | "awaiting_approval" | "pending_confirmation" | "rejected";
  requestedAt?: string | null;
  preferredAt?: string | null;
  proposalId?: string | null;
  note?: string | null;
  customerConfirmed: boolean;
  requestId?: string | null;
  customerName?: string | null;
  contact?: string | null;
  verifiedAddress?: string | null;
  estimateInr?: number | null;
  summary?: string | null;
  outputLines?: string[];
  notificationId?: string | null;
}

export interface LightingJob {
  id: string;
  organizationId: string;
  userId: string;
  agentId: string;
  idempotencyKey: string;
  intake: LightingIntake;
  plan: LightingPlan;
  quote: LightingQuote;
  qloo: QlooTasteResult;
  safety: LightingSafetyRecord;
  address: AddressVerification;
  appointment: LightingAppointment;
  createdAt: string;
  updatedAt: string;
}
