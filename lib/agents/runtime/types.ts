import type { RunDeliveryRecord } from "../delivery/types";
import type { BuilderAgentRecord } from "../runtime-types";
import type { RecordAnalysisResult } from "./analysis/record-validation";

/** Loaded agent ready for execution. */
export interface LoadedAgent {
  record: BuilderAgentRecord;
  /** Gateway slug used in proposals (may differ from DB id). */
  gatewayAgentId: string;
  systemPrompt: string;
  enabledTools: string[];
}

export type ModelTurnType = "complete" | "tool_call";

export interface ModelCompleteTurn {
  type: "complete";
  message: string;
  reasoning?: string;
}

export interface ModelToolCallTurn {
  type: "tool_call";
  toolName: string;
  toolInput: Record<string, unknown>;
  reasoning?: string;
  actionType?: string;
}

export type ModelTurn = ModelCompleteTurn | ModelToolCallTurn;

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ModelCompletionRequest {
  agent: LoadedAgent;
  task: string;
  messages: ModelMessage[];
  enabledToolNames: string[];
}

export interface ToolHandlerContext {
  agent: LoadedAgent;
  runId: string | null;
  userId: string;
  organizationId: string;
}

export type ToolExecutionOutcome =
  | {
      executed: true;
      output: Record<string, unknown>;
    }
  | {
      executed: false;
      output: Record<string, unknown>;
      error: string;
    };

export interface RegisteredTool {
  name: string;
  actionType: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  handler: (
    input: Record<string, unknown>,
    context: ToolHandlerContext
  ) => Promise<ToolExecutionOutcome>;
}

export type ControlDecision = "ALLOW" | "REVIEW" | "BLOCK";

export interface ControlEvaluationResult {
  decision: ControlDecision;
  reason: string;
  why?: string;
  riskLevel?: string;
  riskScore?: number;
  plainEnglishSummary?: string;
  proposalId: string | null;
  canExecute: boolean;
  matchedPolicies: Array<{ name: string; reason: string }>;
}

export interface RuntimeLimits {
  maxToolCalls: number;
  maxTurns: number;
  maxDurationMs: number;
  maxRetries: number;
}

export type RunAgentStatus =
  | "completed"
  | "awaiting_approval"
  | "failed"
  | "cancelled"
  | "timeout";

export interface RunAgentParams {
  agentDbId: string;
  userId: string;
  userEmail: string;
  task: string;
  mode?: "manual" | "test" | "scheduled" | "live";
  triggerSource?: string;
}

export interface RunAgentResult {
  runId: string | null;
  status: RunAgentStatus;
  summary: string | null;
  error: string | null;
  proposalId: string | null;
  toolCalls: number;
  turns: number;
  steps: RuntimeStepSummary[];
  analysis?: RecordAnalysisResult;
  delivery?: RunDeliveryRecord;
  protection?: {
    summary?: string;
    why?: string;
    riskLevel?: string;
    details?: Record<string, unknown>;
  };
}

export interface RuntimeStepSummary {
  key: string;
  label: string;
  detail: string | null;
  status: string;
}
