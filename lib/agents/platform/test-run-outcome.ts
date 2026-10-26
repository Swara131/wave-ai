import type { RecordAnalysisResult } from "@/lib/agents/runtime/analysis/record-validation";
import type { PlatformCheckResult } from "./lifecycle-types";

export type TestRunOutcomeKind = "success" | "empty" | "failed" | "awaiting_approval";

export type DatabaseQueryStatus = "not_run" | "ok" | "empty" | "unavailable" | "failed";

export interface TestRunOutcome {
  kind: TestRunOutcomeKind;
  /** True only when the runtime ran and produced a real result from records. */
  success: boolean;
  queryStatus: DatabaseQueryStatus;
  recordsProcessed: number;
  analysis: RecordAnalysisResult | null;
}

export function resolveTestRunOutcome(params: {
  runStatus?: string;
  runError?: string | null;
  checks?: PlatformCheckResult[];
  analysis?: RecordAnalysisResult | null;
}): TestRunOutcome {
  const analysis = params.analysis ?? null;
  const database = params.checks?.find((check) => check.id === "database");
  const execution = params.checks?.find((check) => check.id === "execution");
  const output = params.checks?.find((check) => check.id === "output");

  let queryStatus: DatabaseQueryStatus = "not_run";
  if (analysis?.unavailable || database?.status === "fail") {
    queryStatus = "unavailable";
  } else if (analysis?.empty || database?.status === "needs_attention") {
    queryStatus = "empty";
  } else if (analysis && analysis.retrievedCount > 0) {
    queryStatus = "ok";
  } else if (database?.status === "pass") {
    queryStatus = "ok";
  } else if (params.runError || params.runStatus === "failed" || params.runStatus === "timeout") {
    queryStatus = analysis ? "failed" : queryStatus;
  }

  if (params.runStatus === "awaiting_approval") {
    return {
      kind: "awaiting_approval",
      success: false,
      queryStatus,
      recordsProcessed: analysis?.analyzedCount ?? 0,
      analysis,
    };
  }

  if (
    params.runStatus === "failed" ||
    params.runStatus === "timeout" ||
    params.runError ||
    execution?.status === "fail" ||
    output?.status === "fail" ||
    analysis?.unavailable
  ) {
    return {
      kind: "failed",
      success: false,
      queryStatus: analysis?.unavailable ? "unavailable" : queryStatus === "not_run" ? "failed" : queryStatus,
      recordsProcessed: analysis?.analyzedCount ?? 0,
      analysis,
    };
  }

  if (analysis?.empty || output?.status === "needs_attention") {
    return {
      kind: "empty",
      success: false,
      queryStatus: "empty",
      recordsProcessed: 0,
      analysis,
    };
  }

  const recordsProcessed = analysis?.analyzedCount ?? 0;
  const succeeded = Boolean(
    params.runStatus === "completed" &&
      execution?.status === "pass" &&
      output?.status === "pass" &&
      (!analysis || analysis.analysisSucceeded)
  );

  return {
    kind: succeeded ? "success" : "failed",
    success: succeeded,
    queryStatus: analysis ? (analysis.analysisSucceeded ? "ok" : queryStatus) : queryStatus,
    recordsProcessed,
    analysis,
  };
}
