import type { AgentDeliveryMode } from "@/lib/agents/delivery/types";
import type { AgentScheduleConfig, AgentSafetySettings } from "@/lib/agents/runtime-types";
import type { AgentWorkflowGraph } from "@/lib/agents/workflow/types";
import type { DecisionAgentConfig } from "@/lib/decision-agents/types";
import type { ExternalAgentConnection } from "@/lib/agents/external/types";

export type RequirementCategory =
  | "model"
  | "workflow"
  | "trigger"
  | "schedule"
  | "tool"
  | "integration"
  | "input"
  | "output"
  | "safety"
  | "decision"
  | "external"
  | "deploy";

export type RequirementStatus = "ready" | "missing" | "optional" | "unavailable";

export type RequirementInputType =
  | "none"
  | "text"
  | "textarea"
  | "email"
  | "phone"
  | "url"
  | "time"
  | "date"
  | "timezone"
  | "radio"
  | "choice"
  | "select"
  | "schedule"
  | "policy"
  | "connection"
  | "checkbox"
  | "file";

export type RequirementConfigurationType = RequirementInputType;

export type RequirementStage = "setup" | "test" | "deploy";

export interface RequirementChoice {
  id: string;
  label: string;
}

export type RequirementKind = "capability" | "configuration" | "business";

export type RequirementScope = "setup" | "run";

export interface RequirementDependency {
  key: string;
  equals: string;
}

export interface AgentRequirement {
  key: string;
  category: RequirementCategory;
  label: string;
  description: string;
  required: boolean;
  status: RequirementStatus;
  reason: string;
  configurationType: RequirementInputType;
  inputType: RequirementInputType;
  value?: string | null;
  options?: RequirementChoice[];
  action?: string;
  actionHref?: string;
  placeholder?: string;
  validation?: "email" | "url" | "phone" | "required";
  kind?: RequirementKind;
  section?: string;
  sectionTitle?: string;
  sectionDescription?: string;
  dependsOn?: RequirementDependency;
  countsTowardProgress?: boolean;
  scope?: RequirementScope;
}

export interface RequirementChoices {
  output?: "notification" | "email" | "whatsapp" | "slack" | "other";
  customerSource?: "crm" | "csv" | "database" | "api" | "other";
  [key: string]: string | undefined;
}

/** Drops undefined values so requirement choice maps can be stored as setup answers. */
export function asSetupAnswers(
  value: Record<string, string | undefined> | null | undefined
): Record<string, string> {
  const answers: Record<string, string> = {};
  if (!value) return answers;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      answers[key] = entry;
    }
  }
  return answers;
}

export interface AgentRequirementSnapshot {
  agentId: string;
  name: string;
  kind: "builder" | "decision" | "external";
  goal?: string | null;
  description?: string | null;
  instructions?: string | null;
  tools?: string[];
  triggerType?: "email" | "webhook" | "schedule";
  schedule?: AgentScheduleConfig | null;
  timezone?: string | null;
  deliveryMode?: AgentDeliveryMode | null;
  destinationEmail?: string | null;
  destinationPhone?: string | null;
  workflow?: AgentWorkflowGraph | null;
  safetySettings?: AgentSafetySettings | null;
  source?: string | null;
  requirementChoices?: RequirementChoices | null;
  setupAnswers?: Record<string, string> | null;
  decisionConfig?: DecisionAgentConfig | null;
  externalConnection?: ExternalAgentConnection | null;
  protectionConfigured?: boolean;
  webSearchConnected?: boolean;
  emailConnected?: boolean;
  whatsappConnected?: boolean;
  stage?: RequirementStage;
}

export interface RequirementSection {
  id: string;
  title: string;
  description: string;
  keys: string[];
}

export interface TestScenarioLine {
  label: string;
  value: string;
}

export interface AgentRequirementsResult {
  agentId: string;
  agentName: string;
  jobProfile?: string;
  requirements: AgentRequirement[];
  sections: RequirementSection[];
  testScenario: TestScenarioLine[];
  readyCount: number;
  requiredCount: number;
  missing: AgentRequirement[];
  runMissing: AgentRequirement[];
  ready: boolean;
  runReady: boolean;
}

export interface AgentReadiness {
  ready: boolean;
  missing: AgentRequirement[];
  requiredCount: number;
  readyCount: number;
}
