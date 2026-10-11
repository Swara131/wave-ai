import { GOOGLE_SHEETS_UNAVAILABLE_MESSAGE } from "@/lib/agents/data-source/config";
import type { ToolExecutionOutcome } from "../../runtime/types";

/** Retired integration. Kept so agents that still list this tool fail clearly instead of crashing. */
export async function handleGoogleSheets(
  input: Record<string, unknown>
): Promise<ToolExecutionOutcome> {
  void input;
  return {
    executed: false,
    error: GOOGLE_SHEETS_UNAVAILABLE_MESSAGE,
    output: {},
  };
}
