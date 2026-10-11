import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";
import type { AgentInterpretation } from "@/lib/agents/builder-types";
import { parseDeliverySettings } from "@/lib/agents/delivery/settings";
import { isWebSearchConfigured } from "@/lib/agents/tools/handlers/web-search";
import { isEmailDeliveryConnected, isWhatsAppDeliveryConnected } from "@/lib/agents/delivery/settings";
import { generateWorkflowFromAgent } from "@/lib/agents/workflow/generate-from-interpretation";
import type { AgentWorkflowGraph } from "@/lib/agents/workflow/types";
import { activeWorkflowGraph, readWorkflowState } from "@/lib/agents/workflow/persistence";
import {
  asSetupAnswers,
  type AgentRequirementSnapshot,
  type RequirementChoices,
  type RequirementStage,
} from "./types";
import { snapshotFromDecisionAgent } from "./from-decision";

export { snapshotFromDecisionAgent };

function inferProtectionConfigured(agent: BuilderAgentRecord): boolean {
  const safety = agent.safetySettings;
  const lifecycleSafety = safety.platformLifecycle?.checks?.find((check) => check.id === "safety");
  return Boolean(
    (safety.requireApprovalFor && safety.requireApprovalFor.length > 0) ||
      safety.thresholdInr != null ||
      lifecycleSafety?.status === "pass"
  );
}

export function snapshotFromBuilderAgent(
  agent: BuilderAgentRecord,
  extras?: {
    stage?: RequirementStage;
    protectionConfigured?: boolean;
    requirementChoices?: RequirementChoices | null;
  }
): AgentRequirementSnapshot {
  const delivery = parseDeliverySettings(agent.safetySettings);
  const persisted = activeWorkflowGraph(readWorkflowState(agent.safetySettings));
  const workflow =
    persisted && persisted.nodes?.length
      ? persisted
      : generateWorkflowFromAgent({
          name: agent.name,
          goal: agent.goal,
          instructions: agent.instructions,
          tools: agent.tools,
          triggerType: agent.triggerType,
          schedule: agent.schedule,
          timezone: agent.timezone,
          deliveryMode: delivery.mode,
        });
  const storedChoices = agent.safetySettings.requirementChoices;
  const setupAnswers =
    agent.safetySettings.setupAnswers ?? asSetupAnswers(storedChoices);

  return {
    agentId: agent.slug,
    name: agent.name,
    kind: agent.safetySettings.externalConnection ? "external" : "builder",
    goal: agent.goal,
    description: agent.description,
    instructions: agent.instructions,
    tools: agent.tools,
    triggerType: agent.triggerType,
    schedule: agent.schedule,
    timezone: agent.timezone,
    deliveryMode: delivery.mode,
    destinationEmail: delivery.destinationEmail,
    destinationPhone: delivery.destinationPhone,
    workflow,
    safetySettings: agent.safetySettings,
    source: agent.source,
    requirementChoices: extras?.requirementChoices ?? storedChoices ?? setupAnswers ?? null,
    setupAnswers,
    externalConnection: agent.safetySettings.externalConnection ?? null,
    protectionConfigured: extras?.protectionConfigured ?? inferProtectionConfigured(agent),
    webSearchConnected: isWebSearchConfigured(),
    emailConnected: isEmailDeliveryConnected(),
    whatsappConnected: isWhatsAppDeliveryConnected(),
    stage: extras?.stage ?? "setup",
  };
}

export function snapshotFromLiveDraft(params: {
  agentId?: string;
  interpretation: AgentInterpretation;
  workflow: AgentWorkflowGraph | null;
  requirementChoices?: RequirementChoices | null;
  setupAnswers?: Record<string, string> | null;
  destinationEmail?: string | null;
  destinationPhone?: string | null;
  stage?: RequirementStage;
}): AgentRequirementSnapshot {
  const setupAnswers = {
    ...asSetupAnswers(params.requirementChoices),
    ...asSetupAnswers(params.setupAnswers),
  };
  return {
    agentId: params.agentId ?? "draft",
    name: params.interpretation.displayName,
    kind: "builder",
    goal: params.interpretation.goal,
    description: params.interpretation.originalDescription,
    instructions: params.interpretation.instructions,
    tools: params.interpretation.tools,
    triggerType: params.interpretation.triggerType,
    schedule: params.interpretation.schedule,
    timezone: params.interpretation.timezone,
    deliveryMode: params.interpretation.deliveryMode,
    destinationEmail: params.destinationEmail ?? null,
    destinationPhone: params.destinationPhone ?? null,
    workflow: params.workflow,
    requirementChoices: params.requirementChoices ?? null,
    setupAnswers: Object.keys(setupAnswers).length > 0 ? setupAnswers : null,
    webSearchConnected: true,
    emailConnected: true,
    whatsappConnected: true,
    protectionConfigured: true,
    stage: params.stage ?? "setup",
  };
}
