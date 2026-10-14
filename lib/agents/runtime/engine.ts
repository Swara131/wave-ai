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
  setupAnswersFromAgent,
} from "./execution-plan";
import {
  agentHasPersistedWorkflow,
  runPersistedWorkflow,
} from "./workflow-executor";
import {
  needsPostRunDelivery,
  parseDeliverySettings,
} from "../delivery/settings";
import type { RunAgentParams, RunAgentResult } from "./types";

export async function runAgentEngine(
  supabase: SupabaseClient,
  params: RunAgentParams
): Promise<RunAgentResult> {
  const admin = createAdminClient();

  await ensureOrganization(supabase, params.userId, params.userEmail);

  const agent = await loadAgentForRuntime(supabase, {
    agentDbId: params.agentDbId,
    userId: params.userId,
    runMode: params.mode ?? "manual",
  });

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

  const result = agentHasPersistedWorkflow(agent)
    ? await runPersistedWorkflow({
        admin,
        agent,
        userId: params.userId,
        task,
        runId,
        limits,
        activity,
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
