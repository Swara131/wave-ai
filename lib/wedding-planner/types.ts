import type { BudgetCategory, EventType, InviteTone, VendorCategory, VenueStyle } from "./constants";

export interface WeddingIntake {
  eventName: string;
  eventType: EventType;
  startDate: string;
  endDate?: string;
  location: string;
  guestCount: number;
  budgetAmount: number;
  budgetCurrency: string;
  couplePreferences: string;
  familyPreferences?: string;
  venueStyle?: VenueStyle;
  cuisine?: string;
  music?: string;
  decorPalette?: string;
  photographyStyle?: string;
  fashionNotes?: string;
  accessibilityNeeds?: string;
  traditions?: string;
  contact?: string;
  existingVendorsNotes?: string;
  isDraft?: boolean;
}

export interface WeddingRecommendation {
  id: string;
  area: "venue" | "cuisine" | "music" | "decor" | "entertainment";
  title: string;
  reason: string;
  basedOn: string[];
  assumption: boolean;
  missingInformation: string[];
}

export interface WeddingPlan {
  sharedPreferences: string[];
  differingPreferences: string[];
  recommendations: WeddingRecommendation[];
  followUps: string[];
  source: "stated_preferences";
  generatedAt: string;
}

export interface WeddingVendor {
  id: string;
  name: string;
  category: VendorCategory;
  location?: string;
  contact?: string;
  quotedAmount: number | null;
  currency: string;
  servicesIncluded?: string;
  availability: "verified" | "unknown" | "unavailable";
  cancellationTerms?: string;
  source: "organizer_entered";
  verificationStatus: "unverified";
  allowlistStatus: "not_approved" | "approved";
  approvedBy?: string | null;
  approvedAt?: string | null;
  paymentRecipientId?: string | null;
  notes?: string;
  quoteFingerprint: string;
}

export interface WeddingTask {
  id: string;
  title: string;
  dueDate?: string;
  startTime?: string;
  endTime?: string;
  vendorId?: string | null;
  done: boolean;
}

export interface WeddingInvitation {
  tone: InviteTone;
  hostNames: string;
  venueName?: string;
  eventTime?: string;
  extraWording?: string;
  draft: string;
  updatedAt: string;
}

export interface WeddingDeposit {
  id: string;
  vendorId: string;
  vendorName: string;
  amount: number;
  currency: string;
  recipientId: string;
  quoteFingerprint: string;
  status:
    | "pending_payment"
    | "awaiting_approval"
    | "approved_awaiting_payment"
    | "blocked"
    | "rejected";
  provider: "none";
  reference: null;
  note: string;
  proposalId?: string | null;
  idempotencyKey: string;
  createdAt: string;
}

export interface WeddingSafetyRecord {
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
  allowlistStatus?: string;
  quoteVerified?: boolean;
  recipientVerified?: boolean;
}

export interface WeddingBudgetSnapshot {
  total: number;
  currency: string;
  planned: number;
  confirmed: number;
  pendingQuotes: number;
  depositsRequested: number;
  depositsApproved: number;
  remaining: number | null;
  categories: Record<BudgetCategory, number>;
}

export interface WeddingEvent {
  id: string;
  organizationId: string;
  userId: string;
  agentId: string;
  idempotencyKey: string;
  intake: WeddingIntake;
  plan: WeddingPlan | null;
  vendors: WeddingVendor[];
  tasks: WeddingTask[];
  invitation: WeddingInvitation | null;
  deposits: WeddingDeposit[];
  budget: WeddingBudgetSnapshot;
  conflicts: string[];
  safety: WeddingSafetyRecord;
  createdAt: string;
  updatedAt: string;
}
