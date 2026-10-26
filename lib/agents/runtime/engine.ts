import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureOrganization } from "@/lib/organizations/ensure-organization";
import { loadAgentForRuntime } from "./agent-loader";
import { RuntimeActivityLogger } from "./activity/activity-logger";
import { resolveRuntimeLimits } from "./config";
import { deliverAgentRunResult } from "../delivery/deliver-agent-result";
import { getAgentRunById, updateAgentRun } from "../runtime-repository";
import { runAgentLoop } from "./run-loop";
import {
  deriveExecutableTaskFromSetup,
  mergeRunInputsIntoAgent,
  setupAnswersFromAgent,
} from "./execution-plan";
import { extractHttpUrl } from "@/lib/http/outbound-url";
import {
  agentHasPersistedWorkflow,
  runPersistedWorkflow,
} from "./workflow-executor";
import {
  needsPostRunDelivery,
  parseDeliverySettings,
} from "../delivery/settings";
import type { RunAgentParams, RunAgentResult } from "./types";
import {
  AGENT_ACTIVATE_ACTION,
  AGENT_ACTIVATE_TOOL,
  ensureAgentActivationApproval,
} from "@/lib/agents/activation/approval";
import type { PendingRuntimeApproval } from "@/lib/agents/protection/types";

export async function runAgentEngine(
  supabase: SupabaseClient,
  params: RunAgentParams
): Promise<RunAgentResult> {
  const admin = createAdminClient();

  await ensureOrganization(supabase, params.userId, params.userEmail);

  const loaded = await loadAgentForRuntime(supabase, {
    agentDbId: params.agentDbId,
    userId: params.userId,
    runMode: params.mode ?? "manual",
  });
  const mergedRecord = mergeRunInputsIntoAgent(loaded.record, params.runInputs);
  const sourceUrl =
    setupAnswersFromAgent(mergedRecord).source_url || extractHttpUrl(params.task) || "";
  const enabledTools =
    sourceUrl && !loaded.enabledTools.includes("fetch_url")
      ? [...loaded.enabledTools, "fetch_url"]
      : loaded.enabledTools;
  const agent = {
    ...loaded,
    record: mergedRecord,
    enabledTools,
  };

  const limits = resolveRuntimeLimits(agent.record);
  const activity = new RuntimeActivityLogger(
    admin,
    agent,
    params.userId,
    limits
  );

  const mode = params.mode ?? "manual";
  const task = deriveExecutableTaskFromSetup({
    goal: agent.record.goal,
    description: agent.record.description,
    setupAnswers: setupAnswersFromAgent(agent.record),
    userTask: params.task,
  });
  console.log("[runtime] run started", {
    agentId: params.agentDbId,
    slug: agent.gatewayAgentId,
    mode,
    trigger: params.triggerSource ?? "api",
  });

  const runId = await activity.createRun({
    task,
    mode,
    triggerSource: params.triggerSource ?? "api",
  });

  const activation = await ensureAgentActivationApproval(admin, {
    agent,
    userId: params.userId,
    runId,
  });

  if (!activation.approved) {
    const pendingApproval: PendingRuntimeApproval = {
      proposalId: activation.proposalId,
      passportId: `activation:${activation.proposalId}`,
      toolName: AGENT_ACTIVATE_TOOL,
      toolInput: { agentName: agent.record.name },
      actionType: AGENT_ACTIVATE_ACTION,
      agentActionId: null,
      turns: 0,
      toolCalls: 0,
      actionSequence: 0,
      messages: [],
      protectionReason: activation.summary,
      riskLevel: "medium",
      summary: activation.summary,
    };

    if (runId) {
      await activity.logRunStep({
        runId,
        key: "agent.activation.approval",
        label: "WAITING FOR APPROVAL",
        detail: activation.summary,
        status: "needs_approval",
      });
      await activity.finishRun({
        runId,
        status: "awaiting_approval",
        summary: activation.summary,
        errorMessage: activation.summary,
        metadata: {
          task,
          pendingApproval,
          activationProposalId: activation.proposalId,
        },
      });
    }

    return {
      runId,
      status: "awaiting_approval",
      summary: activation.summary,
      error: activation.summary,
      proposalId: activation.proposalId,
      toolCalls: 0,
      turns: 0,
      steps: activity.getSteps(),
      protection: {
        summary: activation.summary,
        why: "This agent cannot run until you approve it on the Approvals page.",
        riskLevel: "medium",
        details: { agent: agent.record.name },
      },
    };
  }

  const result = agentHasPersistedWorkflow(agent)
    ? await runPersistedWorkflow({
        admin,
        agent,
        userId: params.userId,
        task,
        runId,
        limits,
        activity,
        sourceImage: params.sourceImage,
      })
    : await runAgentLoop({
        admin,
        agent,
        userId: params.userId,
        task,
        runId,
        limits,
        activity,
        runMode: mode,
      });

  console.log("[runtime] run completed", {
    agentId: params.agentDbId,
    runId: result.runId,
    status: result.status,
    toolCalls: result.toolCalls,
  });

  if (result.status === "completed" && result.summary) {
    const deliverySettings = parseDeliverySettings(agent.record.safetySettings);
    const emailedAlready = result.steps.some(
      (step) => step.key.includes("send_email") && step.status !== "failed"
    );
    const whatsappAlready = result.steps.some(
      (step) => step.key.includes("send_whatsapp") && step.status !== "failed"
    );
    const needsDelivery = needsPostRunDelivery({
      mode: deliverySettings.mode,
      emailedAlready,
      whatsappAlready,
    });

    const persistDelivery = async (delivery: NonNullable<RunAgentResult["delivery"]>) => {
      if (!result.runId) return;
      try {
        const existing = await getAgentRunById(admin, {
          runId: result.runId,
          userId: params.userId,
        });
        await updateAgentRun(admin, {
          runId: result.runId,
          userId: params.userId,
          status: result.status === "failed" ? "failed" : existing?.status,
          errorMessage: result.error,
          metadata: {
            ...(existing?.metadata ?? {}),
            delivery,
          },
        });
      } catch (err) {
        console.warn("[runtime] Failed to persist delivery metadata:", err);
      }
    };

    if (needsDelivery) {
      const delivery = await deliverAgentRunResult({
        admin,
        agent,
        userId: params.userId,
        userEmail: params.userEmail,
        runId: result.runId,
        runMode: params.mode ?? "manual",
        summary: result.summary,
        activity,
      });

      result.delivery = delivery;
      result.steps = activity.getSteps();

      if (delivery.status === "failed") {
        result.status = "failed";
        result.error = delivery.error ?? "Delivery failed.";
      }
      await persistDelivery(delivery);
    } else if (result.delivery) {
      await persistDelivery(result.delivery);
    }
  }

  return result;
}
