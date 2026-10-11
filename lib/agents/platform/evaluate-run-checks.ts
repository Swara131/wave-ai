import {
  analysisFromQueryToolOutput,
  isMeaningfulAnalysisOutput,
} from "@/lib/agents/runtime/analysis/structured-report";
import type { RecordAnalysisResult } from "@/lib/agents/runtime/analysis/record-validation";
import { hasQueryDatabaseTool } from "@/lib/agents/runtime/data/resolve-query-source";
import { isPromptEcho } from "@/lib/agents/runtime/model/task-intent";
import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";
import type { PlatformCheckResult } from "./lifecycle-types";

export function evaluateExecutionCheck(params: {
  status: string;
  error?: string | null;
  summary?: string | null;
  task: string;
  toolFailed?: boolean;
}): PlatformCheckResult {
  const now = new Date().toISOString();
  if (params.toolFailed || params.status === "failed" || params.status === "timeout") {
    return {
      id: "execution",
      label: "Execution",
      status: "fail",
      message: params.error || "Agent execution failed.",
      checkedAt: now,
    };
  }

  if (params.status === "awaiting_approval") {
    return {
      id: "execution",
      label: "Execution",
      status: "pass",
      message: "Agent ran and routed an action for approval.",
      checkedAt: now,
    };
  }

  if (params.status !== "completed") {
    return {
      id: "execution",
      label: "Execution",
      status: "fail",
      message: params.error || "Agent execution did not complete.",
      checkedAt: now,
    };
  }

  if (params.summary && isPromptEcho(params.summary, params.task)) {
    return {
      id: "execution",
      label: "Execution",
      status: "fail",
      message: "Runtime echoed the original prompt or saved configuration instead of executing the task.",
      checkedAt: now,
    };
  }

  return {
    id: "execution",
    label: "Execution",
    status: "pass",
    message: "Agent executed through the real runtime.",
    checkedAt: now,
  };
}

export function evaluateOutputCheck(params: {
  agent: BuilderAgentRecord;
  status: string;
  summary?: string | null;
  task: string;
  error?: string | null;
  queryOutput?: Record<string, unknown> | null;
  analysis?: RecordAnalysisResult | null;
}): PlatformCheckResult {
  const now = new Date().toISOString();
  const needsData = hasQueryDatabaseTool(params.agent.tools);

  if (params.status === "failed" || params.status === "timeout") {
    return {
      id: "output",
      label: "Output",
      status: "fail",
      message: params.error || "No output because execution failed.",
      checkedAt: now,
    };
  }

  const analysis =
    params.analysis ??
    (params.queryOutput
      ? analysisFromQueryToolOutput({
          toolOutput: params.queryOutput,
          agent: params.agent,
          task: params.task,
        })
      : null);

  if (analysis) {
    if (analysis.unavailable) {
      return {
        id: "output",
        label: "Output",
        status: "fail",
        message:
          analysis.errors[0] ??
          "Database is unavailable or disconnected. No records were analyzed.",
        checkedAt: now,
      };
    }
    if (analysis.empty) {
      return {
        id: "output",
        label: "Output",
        status: "needs_attention",
        message: "Database is empty. 0 records were analyzed.",
        checkedAt: now,
      };
    }
    if (!analysis.analysisSucceeded) {
      return {
        id: "output",
        label: "Output",
        status: "fail",
        message: "Query ran but no records were analyzed.",
        checkedAt: now,
      };
    }
  }

  if (!params.summary?.trim()) {
    return {
      id: "output",
      label: "Output",
      status: "fail",
      message: "No output produced.",
      checkedAt: now,
    };
  }

  if (isPromptEcho(params.summary, params.task)) {
    return {
      id: "output",
      label: "Output",
      status: "fail",
      message: "Output repeated the original prompt or saved configuration.",
      checkedAt: now,
    };
  }

  if (needsData && !isMeaningfulAnalysisOutput(params.summary, params.task)) {
    return {
      id: "output",
      label: "Output",
      status: "fail",
      message: "Output was not a meaningful analysis of retrieved records.",
      checkedAt: now,
    };
  }

  if (/no real analysis succeeded|0 records were retrieved|database is empty/i.test(params.summary)) {
    return {
      id: "output",
      label: "Output",
      status: "needs_attention",
      message: "Runtime reported that no records were analyzed.",
      checkedAt: now,
    };
  }

  if (/database is unavailable|disconnected/i.test(params.summary)) {
    return {
      id: "output",
      label: "Output",
      status: "fail",
      message: "Runtime reported the database is unavailable.",
      checkedAt: now,
    };
  }

  return {
    id: "output",
    label: "Output",
    status: "pass",
    message: "Agent produced a meaningful result from the runtime.",
    checkedAt: now,
  };
}
