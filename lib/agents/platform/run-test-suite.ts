import type { SupabaseClient } from "@supabase/supabase-js";
import type { CrmUpdateResult, WhatsAppNotifyResult } from "@/lib/agents/crm/types";
import { runAgentEngine } from "@/lib/agents/runtime/run-agent";
import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";
import {
  deriveExecutableTaskFromSetup,
  setupAnswersFromAgent,
} from "@/lib/agents/runtime/execution-plan";
import { assertBuilderAgentRequirementsReady } from "@/lib/agents/requirements/assert-ready";
import type { AgentPlatformLifecycle, PlatformCheckResult } from "./lifecycle-types";
import { evaluateExecutionCheck, evaluateOutputCheck } from "./evaluate-run-checks";
import { verifyAgentPlatform } from "./verify-agent";
import { isPromptEcho } from "@/lib/agents/runtime/model/task-intent";
import type { RecordAnalysisResult } from "@/lib/agents/runtime/analysis/record-validation";
import { resolveTestRunOutcome, type TestRunOutcome } from "./test-run-outcome";

export interface TestSuiteResult {
  lifecycle: AgentPlatformLifecycle;
  runId?: string | null;
  runStatus?: string;
  runSummary?: string | null;
  runError?: string | null;
  crmResult?: CrmUpdateResult;
  whatsappResult?: WhatsAppNotifyResult | null;
  analysis?: RecordAnalysisResult | null;
  outcome?: TestRunOutcome;
}

export async function runAgentTestSuite(
  supabase: SupabaseClient,
  params: {
    agent: BuilderAgentRecord;
    userId: string;
    userEmail: string;
    task?: string;
    existingLifecycle?: AgentPlatformLifecycle;
  }
): Promise<TestSuiteResult> {
  assertBuilderAgentRequirementsReady(params.agent, "test");

  let executionCheck: PlatformCheckResult;
  let outputCheck: PlatformCheckResult;
  let runId: string | null = null;
  let runStatus: string | undefined;
  let runSummary: string | null = null;
  let runError: string | null = null;
  let analysis: RecordAnalysisResult | null = null;

  const task =
    params.task?.trim() ||
    deriveExecutableTaskFromSetup({
      goal: params.agent.goal,
      description: params.agent.description,
      setupAnswers: setupAnswersFromAgent(params.agent),
    });

  try {
    const result = await runAgentEngine(supabase, {
      agentDbId: params.agent.id,
      userId: params.userId,
      userEmail: params.userEmail,
      task,
      mode: "test",
    });

    runId = result.runId ?? null;
    runStatus = result.status;
    runSummary = result.summary ?? null;
    runError = result.error ?? null;
    analysis = result.analysis ?? null;

    const queryStep = result.steps.find((step) => step.key.includes("query_supabase"));
    const toolFailed = result.steps.some((step) => step.status === "failed");

    executionCheck = evaluateExecutionCheck({
      status: result.status,
      error:
        result.error ??
        result.delivery?.error ??
        result.delivery?.email?.error ??
        result.delivery?.whatsapp?.error,
      summary: result.summary,
      task,
      toolFailed,
    });

    const delivery = result.delivery;
    if (delivery?.whatsapp?.status === "failed") {
      outputCheck = {
        id: "output",
        label: "WhatsApp Notification",
        status: "fail",
        message: delivery.whatsapp.error ?? "WhatsApp delivery failed.",
        fixHref: "/settings?tab=integrations&provider=whatsapp",
        fixLabel: "Configure WhatsApp",
        checkedAt: new Date().toISOString(),
      };
    } else if (delivery?.email?.status === "failed" || delivery?.status === "failed") {
      outputCheck = {
        id: "output",
        label: "Email delivery",
        status: "fail",
        message: delivery.email?.error ?? delivery.error ?? "Delivery did not succeed.",
        fixHref: "/settings?tab=integrations&provider=email",
        fixLabel: "Configure email",
        checkedAt: new Date().toISOString(),
      };
    } else {
      outputCheck = evaluateOutputCheck({
        agent: params.agent,
        status: result.status,
        summary: result.summary,
        task,
        error: result.error,
        analysis,
      });
      if (
        delivery?.whatsapp?.status === "sent" &&
        outputCheck.status === "pass"
      ) {
        outputCheck = {
          ...outputCheck,
          label: "WhatsApp Notification",
          message: `Sent to ${delivery.whatsapp.destination ?? "recipient"}.`,
        };
      } else if (delivery?.email?.status === "sent" && outputCheck.status === "pass") {
        outputCheck = {
          ...outputCheck,
          label: "Email delivery",
          message: `Sent to ${delivery.email.destination ?? "recipient"}.`,
        };
      }
    }

    if (queryStep && isPromptEcho(result.summary ?? "", task)) {
      executionCheck = evaluateExecutionCheck({
        status: "failed",
        error: "Runtime echoed the original prompt after querying data.",
        summary: result.summary,
        task,
        toolFailed: true,
      });
    }
  } catch (err) {
    runError = err instanceof Error ? err.message : "Test run failed.";
    executionCheck = {
      id: "execution",
      label: "Execution",
      status: "fail",
      message: runError,
      fixHref: `/agents/${encodeURIComponent(params.agent.slug)}/edit`,
      fixLabel: "Fix agent",
      checkedAt: new Date().toISOString(),
    };
    outputCheck = {
      id: "output",
      label: "Output",
      status: "not_run",
      message: "Skipped because execution failed.",
      checkedAt: new Date().toISOString(),
    };
  }

  const lifecycle = await verifyAgentPlatform(supabase, params.agent, {
    executionCheck,
    outputCheck,
  });

  lifecycle.stage = "testing";
  lifecycle.lastTestedAt = new Date().toISOString();

  if (params.existingLifecycle?.testCases.length) {
    lifecycle.testCases = params.existingLifecycle.testCases.map((testCase) => {
      if (testCase.status !== "not_run") return testCase;
      return {
        ...testCase,
        status:
          executionCheck.status === "pass" && outputCheck.status === "pass"
            ? ("pass" as const)
            : ("fail" as const),
        actualResult: runSummary ?? runError ?? testCase.actualResult,
        lastRunAt: new Date().toISOString(),
      };
    });
  }

  const outcome = resolveTestRunOutcome({
    runStatus,
    runError,
    checks: lifecycle.checks,
    analysis,
  });

  return {
    lifecycle,
    runId,
    runStatus,
    runSummary,
    runError,
    analysis,
    outcome,
  };
}
