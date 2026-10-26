import type { PolicyRuleDefinition } from "@/lib/gateway/policy/types";
import { lightingProtectionPolicies } from "@/lib/lighting-concierge/policies";
import { travelProtectionPolicies } from "@/lib/travel-companion/policies";
import { weddingProtectionPolicies } from "@/lib/wedding-planner/policies";
import { groupProtectionPolicies } from "@/lib/group-planner/policies";
import type { AgentSafetySettings } from "../runtime-types";

/** Practical Wave Protection rules for agent runtime actions. */
export const ZELTA_PROTECTION_POLICIES: PolicyRuleDefinition[] = [
  {
    id: "zelta-block-destructive-production",
    name: "Block destructive production actions",
    description: "Destructive actions against production systems are never allowed.",
    priority: 5,
    decision: "BLOCK",
    conditions: {
      destructiveOperation: true,
      productionTarget: true,
    },
  },
  {
    id: "zelta-review-destructive-data",
    name: "Data deletion requires review",
    description: "Deleting or destroying data pauses until you approve or deny.",
    priority: 6,
    decision: "REVIEW",
    conditions: {
      destructiveOperation: true,
    },
  },
  {
    id: "zelta-refund-review",
    name: "Financial refund requires review",
    description: "Refunds and other payment actions require your approval.",
    priority: 15,
    decision: "REVIEW",
    conditions: {
      toolName: "issue_refund",
      actionType: "financial.refund",
    },
  },
  {
    id: "zelta-whatsapp-review",
    name: "WhatsApp sending requires review",
    description: "Sending a WhatsApp message requires your approval.",
    priority: 18,
    decision: "REVIEW",
    conditions: {
      toolName: "send_whatsapp_message",
    },
  },
  {
    id: "zelta-crm-write-review",
    name: "CRM changes require review",
    description: "Creating, updating, or deleting CRM records requires your approval.",
    priority: 18,
    decision: "REVIEW",
    conditions: {
      toolName: ["update_crm_record", "delete_crm_record"],
    },
  },
  {
    id: "zelta-email-review-bulk",
    name: "Bulk email requires review",
    description: "Sending email to many recipients requires your approval.",
    priority: 20,
    decision: "REVIEW",
    conditions: {
      toolName: "send_email",
      actionType: "communication.email",
      dataExportSizeMin: 11,
    },
  },
  {
    id: "zelta-email-allow-single",
    name: "Single email auto-allow",
    description: "Sending a normal email to one recipient is allowed.",
    priority: 25,
    decision: "ALLOW",
    conditions: {
      toolName: "send_email",
      actionType: "communication.email",
      dataExportSizeMax: 10,
    },
  },
  {
    id: "zelta-export-review-large",
    name: "Large data export requires review",
    description: "Exporting more than 100 records requires approval.",
    priority: 35,
    decision: "REVIEW",
    conditions: {
      dataExportSizeMin: 101,
    },
  },
  {
    id: "zelta-allow-read-tools",
    name: "Allow read-only research",
    description: "Read-only lookups and research are allowed.",
    priority: 900,
    decision: "ALLOW",
    conditions: {
      toolName: ["web_search", "read_document", "query_supabase", "google_sheets", "x_search"],
    },
  },
];

export function getZeltaProtectionPolicies(): PolicyRuleDefinition[] {
  return ZELTA_PROTECTION_POLICIES.map((policy) => ({
    ...policy,
    conditions: { ...policy.conditions },
  }));
}

export function buildAgentSafetyPolicyRules(
  settings: AgentSafetySettings,
  thresholdInr: number
): PolicyRuleDefinition[] {
  const rules: PolicyRuleDefinition[] = [];

  if (thresholdInr > 0) {
    rules.push({
      id: "agent-threshold-refund-review",
      name: "Agent refund threshold",
      description: `Refunds above ₹${thresholdInr.toLocaleString("en-IN")} require approval.`,
      priority: 12,
      decision: "REVIEW",
      conditions: {
        toolName: "issue_refund",
        actionType: "financial.refund",
        currency: "INR",
        amountMin: Math.round(thresholdInr * 100) + 1,
      },
    });
    rules.push(...lightingProtectionPolicies(thresholdInr));
    rules.push(...travelProtectionPolicies(thresholdInr));
    rules.push(...weddingProtectionPolicies(settings.weddingPlanner?.depositThresholdInr ?? thresholdInr));
    rules.push(...groupProtectionPolicies(settings.groupPlanner?.reservationThresholdInr ?? thresholdInr));
  }

  for (const toolName of settings.requireApprovalFor ?? []) {
    rules.push({
      id: `agent-require-approval-${toolName}`,
      name: "Your protection settings",
      description: `You asked Wave to require approval before ${toolName.replace(/_/g, " ")}.`,
      priority: 14,
      decision: "REVIEW",
      conditions: { toolName },
    });
  }

  return rules;
}
