import type { DecisionAgentConfig, DecisionInputField } from "./types";

export function decisionInputLabel(key: string): string {
  switch (key) {
    case "refund_amount":
      return "Customer refund amount (₹)";
    case "customer_eligible":
      return "Customer eligible";
    case "risk_score":
      return "Risk score (0–1)";
    case "order_age":
    case "order_age_days":
      return "Order age (days)";
    case "lead_signals":
      return "Lead signals";
    case "expense_details":
      return "Expense details";
    case "request_context":
      return "Request context";
    case "claim_summary":
      return "What decision or claim should be evaluated?";
    case "information_source":
      return "Where did these facts come from?";
    case "investor_profile":
      return "Who is this for?";
    default:
      return key.replace(/_/g, " ");
  }
}

/** Never pre-fill fake case data. The operator must type real facts. */
export function defaultInputValue(_key: string): string {
  return "";
}

export function fieldsForConfig(config: DecisionAgentConfig): DecisionInputField[] {
  if (config.inputFields && config.inputFields.length > 0) return config.inputFields;
  return config.inputs.map((key) => ({
    key,
    label: decisionInputLabel(key),
    type:
      key === "customer_eligible" || key === "policy_match"
        ? "boolean"
        : key.includes("amount") || key.includes("score") || key.includes("age")
          ? "number"
          : key.includes("details") || key.includes("profile") || key.includes("summary")
            ? "textarea"
            : "text",
    required: true,
    description: "Enter a real value. Wave will not invent one.",
    options:
      key === "customer_eligible"
        ? [
            { id: "true", label: "Yes" },
            { id: "false", label: "No" },
          ]
        : undefined,
  }));
}

export function parseInputValue(key: string, raw: string, type?: DecisionInputField["type"]): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (type === "boolean" || key === "customer_eligible" || key === "policy_match") {
    return trimmed === "true" || trimmed === "yes";
  }
  if (type === "number" || key === "refund_amount" || key === "risk_score" || key === "order_age" || key === "order_age_days") {
    const num = Number(trimmed.replace(/[,₹$]/g, ""));
    return Number.isFinite(num) ? num : trimmed;
  }
  return trimmed;
}
