import {
  CREATE_QUOTE_TOOL,
  LIGHTING_TEMPLATE_SLUG,
  REQUEST_VISIT_TOOL,
  VERIFY_ADDRESS_TOOL,
} from "@/lib/lighting-concierge/constants";
import {
  PLAN_ITINERARY_TOOL,
  REQUEST_BOOKING_TOOL,
  TRAVEL_TEMPLATE_SLUG,
} from "@/lib/travel-companion/constants";
import {
  PLAN_WEDDING_TOOL,
  REQUEST_DEPOSIT_TOOL,
  WEDDING_TEMPLATE_SLUG,
} from "@/lib/wedding-planner/constants";
import {
  PLAN_GROUP_TOOL,
  REQUEST_RESERVATION_TOOL,
  GROUP_TEMPLATE_SLUG,
} from "@/lib/group-planner/constants";
import type { PendingApproval } from "@/lib/approval-types";

const LIGHTING_TOOLS = new Set([CREATE_QUOTE_TOOL, VERIFY_ADDRESS_TOOL, REQUEST_VISIT_TOOL]);
const TRAVEL_TOOLS = new Set([PLAN_ITINERARY_TOOL, REQUEST_BOOKING_TOOL]);
const WEDDING_TOOLS = new Set([PLAN_WEDDING_TOOL, REQUEST_DEPOSIT_TOOL]);
const GROUP_TOOLS = new Set([PLAN_GROUP_TOOL, REQUEST_RESERVATION_TOOL]);

export function approvalAgentSlug(approval: PendingApproval): string {
  const payload = approval.actionPayload ?? {};
  const fromPayload = typeof payload.slug === "string" ? payload.slug.trim() : "";
  if (fromPayload) return fromPayload;
  const storedSlug = approval.agentSlug?.trim() ?? "";
  if (storedSlug) return storedSlug;
  const requester = approval.requester?.trim() ?? "";
  if (requester && requester !== "Unassigned") return requester;
  return approval.agentId.trim();
}

export function isLightingApproval(approval: PendingApproval): boolean {
  const tool = approval.toolName ?? "";
  const action = approval.actionType ?? "";
  const slug = approvalAgentSlug(approval).toLowerCase();
  return (
    LIGHTING_TOOLS.has(tool) ||
    action.startsWith("service.") ||
    slug.includes(LIGHTING_TEMPLATE_SLUG)
  );
}

export function isTravelApproval(approval: PendingApproval): boolean {
  const tool = approval.toolName ?? "";
  const action = approval.actionType ?? "";
  const slug = approvalAgentSlug(approval).toLowerCase();
  return TRAVEL_TOOLS.has(tool) || action.startsWith("travel.") || slug.includes(TRAVEL_TEMPLATE_SLUG);
}

export function isWeddingApproval(approval: PendingApproval): boolean {
  const tool = approval.toolName ?? "";
  const action = approval.actionType ?? "";
  const slug = approvalAgentSlug(approval).toLowerCase();
  return WEDDING_TOOLS.has(tool) || action.startsWith("wedding.") || slug.includes(WEDDING_TEMPLATE_SLUG);
}

export function isGroupApproval(approval: PendingApproval): boolean {
  const tool = approval.toolName ?? "";
  const action = approval.actionType ?? "";
  const slug = approvalAgentSlug(approval).toLowerCase();
  return GROUP_TOOLS.has(tool) || action.startsWith("group.") || slug.includes(GROUP_TEMPLATE_SLUG);
}

export function continueHrefAfterApproval(
  approval: PendingApproval,
  options?: { resumed?: boolean }
): string {
  const slug = encodeURIComponent(approvalAgentSlug(approval));
  if (isLightingApproval(approval)) {
    return `/agents/${slug}/lighting`;
  }
  if (isTravelApproval(approval)) {
    return `/agents/${slug}/travel`;
  }
  if (isWeddingApproval(approval)) {
    return `/agents/${slug}/wedding`;
  }
  if (isGroupApproval(approval)) {
    return `/agents/${slug}/group`;
  }
  if (options?.resumed) {
    return `/agents/${slug}?tab=runs`;
  }
  const tool = approval.toolName ?? "";
  const action = approval.actionType ?? "";
  if (tool === "activate_agent" || action === "agent.activate") {
    return `/agents/${slug}?run=1`;
  }
  return `/agents/${slug}?run=1`;
}
