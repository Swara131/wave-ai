import type {
  DecisionAgentConfig,
  DecisionInputField,
  DecisionOutcome,
  DecisionRiskLevel,
  DecisionUnit,
  DecisionWorkflowNode,
  GeneratedDecisionAgentPreview,
} from "./types";
import { defaultDecisionEdges, layoutDecisionWorkflow } from "./canvas-graph";

function slugId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`;
}

function extractName(prompt: string, fallback?: string): string {
  const quoted = prompt.match(/called\s+"([^"]+)"/i) ?? prompt.match(/called\s+'([^']+)'/i);
  if (quoted?.[1]?.trim()) return quoted[1].trim();
  if (fallback?.trim()) return fallback.trim();
  const trimmed = prompt.trim();
  return trimmed.length > 52 ? `${trimmed.slice(0, 49)}… Agent` : `${trimmed} Agent`;
}

function field(
  key: string,
  label: string,
  type: DecisionInputField["type"],
  description: string,
  extra?: Partial<DecisionInputField>
): DecisionInputField {
  return { key, label, type, required: true, description, ...extra };
}

function isRefundPrompt(prompt: string): boolean {
  return /\brefund\b/i.test(prompt);
}

function isFraudPrompt(prompt: string): boolean {
  return /\bfraud\b|\bsuspicious transaction/i.test(prompt);
}

function isLeadPrompt(prompt: string): boolean {
  return /\blead\b|\bqualif/i.test(prompt) && !/\bipo\b/i.test(prompt);
}

function refundFields(): DecisionInputField[] {
  return [
    field("refund_amount", "Refund amount (₹)", "number", "The actual refund requested. Do not guess."),
    field("customer_eligible", "Is this customer eligible under your policy?", "boolean", "Yes only if you have confirmed eligibility.", {
      options: [
        { id: "true", label: "Yes" },
        { id: "false", label: "No" },
      ],
    }),
    field("risk_score", "Risk score (0–1)", "number", "From your fraud or risk system. Leave blank if unknown."),
    field("order_age_days", "Order age (days)", "number", "How many days since the order, if you know it.", {
      required: false,
    }),
  ];
}

function researchFields(): DecisionInputField[] {
  return [
    field(
      "claim_summary",
      "What decision or claim should be evaluated?",
      "textarea",
      "The actual situation, in your words. Wave will not invent facts."
    ),
    field(
      "information_source",
      "Where did these facts come from?",
      "text",
      "Official filing, exchange, SEBI, company site, news, or unknown."
    ),
    field(
      "investor_profile",
      "Who is this for?",
      "textarea",
      "Retail / professional, experience, and any constraints you actually know."
    ),
    field(
      "capital_at_risk",
      "Capital at risk (optional, ₹ or %)",
      "text",
      "Only if the person stated an amount. Leave blank if unknown.",
      { required: false }
    ),
    field("risk_tolerance", "Stated risk tolerance", "choice", "Use only what they told you.", {
      required: false,
      options: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
        { id: "unknown", label: "Not stated" },
      ],
    }),
  ];
}

function fraudFields(): DecisionInputField[] {
  return [
    field("transaction_details", "Transaction details", "textarea", "Amount, channel, and what looked unusual."),
    field("account_signals", "Account or device signals", "textarea", "Only signals you actually have."),
    field("risk_score", "Risk score (0–1)", "number", "From your risk engine, if available.", { required: false }),
  ];
}

function leadFields(): DecisionInputField[] {
  return [
    field("company_name", "Company", "text", "The real company name."),
    field("role_intent", "Role and intent", "textarea", "What they asked for and their job."),
    field("fit_notes", "Fit notes", "textarea", "Budget, timeline, or other facts you have.", { required: false }),
  ];
}

function refundDecisions(): DecisionUnit[] {
  return [
    {
      id: "eligibility",
      title: "Is the customer eligible?",
      description: "Eligibility must be stated. Wave will not assume yes.",
      inputs: ["customer_eligible"],
      rules: [
        {
          id: "elig-no",
          label: "Not eligible",
          expression: "customer_eligible = false",
          outcome: "block",
          isAiGenerated: true,
        },
        {
          id: "elig-yes",
          label: "Eligible",
          expression: "customer_eligible = true",
          outcome: "allow",
          isAiGenerated: true,
        },
        {
          id: "elig-missing",
          label: "Eligibility unknown",
          expression: "otherwise",
          outcome: "review",
          isAiGenerated: true,
        },
      ],
    },
    {
      id: "amount",
      title: "Is the amount within automatic policy?",
      description: "Uses the refund amount you entered.",
      inputs: ["refund_amount"],
      rules: [
        {
          id: "amt-allow",
          label: "Within threshold",
          expression: "refund_amount <= threshold",
          outcome: "allow",
          isAiGenerated: true,
        },
        {
          id: "amt-review",
          label: "Above threshold",
          expression: "otherwise",
          outcome: "review",
          isAiGenerated: true,
        },
      ],
    },
    {
      id: "risk",
      title: "Is risk low enough to auto-approve?",
      description: "Uses the risk score you provided.",
      inputs: ["risk_score"],
      rules: [
        {
          id: "risk-block",
          label: "High risk",
          expression: "risk_score >= 0.75",
          outcome: "block",
          isAiGenerated: true,
        },
        {
          id: "risk-allow",
          label: "Low risk",
          expression: "risk_score < 0.5",
          outcome: "allow",
          isAiGenerated: true,
        },
        {
          id: "risk-review",
          label: "Risk unknown or moderate",
          expression: "otherwise",
          outcome: "review",
          isAiGenerated: true,
        },
      ],
    },
  ];
}

function researchDecisions(prompt: string): DecisionUnit[] {
  const topic = /\bipo\b/i.test(prompt) ? "IPO / listing" : "this opportunity";
  return [
    {
      id: "source_quality",
      title: "Are the facts from verified sources?",
      description: "Official filings beat rumors. Unstated sources stay on review.",
      inputs: ["information_source"],
      rules: [
        {
          id: "src-ok",
          label: "Official or regulator source",
          expression:
            "information_source contains sebi OR information_source contains exchange OR information_source contains official OR information_source contains filing OR information_source contains company",
          outcome: "allow",
          isAiGenerated: true,
        },
        {
          id: "src-review",
          label: "Unverified or missing source",
          expression: "otherwise",
          outcome: "review",
          isAiGenerated: true,
        },
      ],
    },
    {
      id: "risk_stance",
      title: `What risk stance fits this person for ${topic}?`,
      description: "Uses only the profile and tolerance they gave.",
      inputs: ["investor_profile", "risk_tolerance", "capital_at_risk"],
      rules: [
        {
          id: "risk-high",
          label: "High stated risk and large capital",
          expression: "risk_tolerance = high AND capital_at_risk contains high",
          outcome: "review",
          isAiGenerated: true,
        },
        {
          id: "risk-low",
          label: "Low risk tolerance",
          expression: "risk_tolerance = low",
          outcome: "review",
          isAiGenerated: true,
        },
        {
          id: "risk-unknown",
          label: "Profile incomplete",
          expression: "otherwise",
          outcome: "review",
          isAiGenerated: true,
        },
      ],
    },
    {
      id: "recommend_action",
      title: "Should Wave recommend applying or acting now?",
      description: "Never blindly recommend. ALLOW only if sources are official and the person asked for a next step.",
      inputs: ["claim_summary", "information_source"],
      rules: [
        {
          id: "act-block",
          label: "Do not recommend applying blindly",
          expression:
            "claim_summary contains apply AND information_source contains rumor OR information_source contains unknown OR information_source contains tip",
          outcome: "block",
          isAiGenerated: true,
        },
        {
          id: "act-allow",
          label: "Informational next step only",
          expression:
            "information_source contains sebi OR information_source contains official OR information_source contains filing",
          outcome: "allow",
          isAiGenerated: true,
        },
        {
          id: "act-review",
          label: "Needs human judgment",
          expression: "otherwise",
          outcome: "review",
          isAiGenerated: true,
        },
      ],
    },
  ];
}

function fraudDecisions(): DecisionUnit[] {
  return [
    {
      id: "signals",
      title: "Do the stated signals look high-risk?",
      description: "Uses transaction notes you entered.",
      inputs: ["transaction_details", "account_signals"],
      rules: [
        {
          id: "sig-block",
          label: "Clear fraud language",
          expression:
            "transaction_details contains fraud OR account_signals contains stolen OR transaction_details contains mule",
          outcome: "block",
          isAiGenerated: true,
        },
        {
          id: "sig-review",
          label: "Needs review",
          expression: "otherwise",
          outcome: "review",
          isAiGenerated: true,
        },
      ],
    },
    {
      id: "score",
      title: "Does the risk score require a hold?",
      description: "Blank scores are review, not allow.",
      inputs: ["risk_score"],
      rules: [
        {
          id: "score-block",
          label: "High score",
          expression: "risk_score >= 0.75",
          outcome: "block",
          isAiGenerated: true,
        },
        {
          id: "score-allow",
          label: "Low score",
          expression: "risk_score < 0.4",
          outcome: "allow",
          isAiGenerated: true,
        },
        {
          id: "score-review",
          label: "Unknown or mid score",
          expression: "otherwise",
          outcome: "review",
          isAiGenerated: true,
        },
      ],
    },
  ];
}

function leadDecisions(): DecisionUnit[] {
  return [
    {
      id: "fit",
      title: "Is there a real company and intent?",
      description: "Blank company is not a qualified lead.",
      inputs: ["company_name", "role_intent"],
      rules: [
        {
          id: "fit-allow",
          label: "Company and intent present",
          expression: "company_name AND role_intent",
          outcome: "allow",
          isAiGenerated: true,
        },
        {
          id: "fit-review",
          label: "Incomplete lead",
          expression: "otherwise",
          outcome: "review",
          isAiGenerated: true,
        },
      ],
    },
    {
      id: "outreach",
      title: "Should outreach proceed automatically?",
      description: "Automatic outreach stays on review unless fit is explicit.",
      inputs: ["fit_notes"],
      rules: [
        {
          id: "out-review",
          label: "Human writes outreach",
          expression: "otherwise",
          outcome: "review",
          isAiGenerated: true,
        },
      ],
    },
  ];
}

function workflowFromDecisions(name: string, decisions: DecisionUnit[]): DecisionWorkflowNode[] {
  const nodes: DecisionWorkflowNode[] = [
    {
      id: "intake",
      type: "input",
      name: "Case facts",
      description: "Collect only facts the operator provides",
      position: 0,
    },
  ];
  decisions.forEach((decision, index) => {
    nodes.push({
      id: decision.id,
      type: "decision",
      name: decision.title,
      description: decision.description,
      position: index + 1,
    });
  });
  nodes.push({
    id: "combine",
    type: "policy",
    name: "Combine decisions",
    description: "Block wins over review, review wins over allow",
    position: nodes.length,
  });
  nodes.push({
    id: "output",
    type: "action",
    name: "Live result",
    description: `${name} writes every decision and the overall outcome`,
    position: nodes.length,
  });
  return layoutDecisionWorkflow(nodes);
}

export function generateDecisionAgentFromPrompt(params: {
  prompt: string;
  name?: string;
  decisionType?: string;
}): GeneratedDecisionAgentPreview {
  const purpose = params.prompt.trim();
  const name = extractName(purpose, params.name);

  let inputFields: DecisionInputField[];
  let decisions: DecisionUnit[];
  let decisionType = params.decisionType ?? "custom";

  if (isRefundPrompt(purpose) || decisionType === "refund") {
    inputFields = refundFields();
    decisions = refundDecisions();
    decisionType = "refund";
  } else if (isFraudPrompt(purpose) || decisionType === "fraud_review") {
    inputFields = fraudFields();
    decisions = fraudDecisions();
    decisionType = "fraud_review";
  } else if (isLeadPrompt(purpose) || decisionType === "lead_qualification") {
    inputFields = leadFields();
    decisions = leadDecisions();
    decisionType = "lead_qualification";
  } else {
    inputFields = researchFields();
    decisions = researchDecisions(purpose);
    decisionType = decisionType === "custom" ? "multi_decision" : decisionType;
  }

  const inputs = inputFields.map((item) => item.key);
  const rules = decisions.flatMap((unit) => unit.rules);
  const possibleOutcomes: DecisionOutcome[] = ["allow", "review", "block"];
  const riskLevel: DecisionRiskLevel = isFraudPrompt(purpose)
    ? "high"
    : isRefundPrompt(purpose)
      ? "medium"
      : "medium";
  const createdAt = new Date().toISOString();
  const workflow = workflowFromDecisions(name, decisions);

  const config: DecisionAgentConfig = {
    decisionQuestion: purpose,
    inputs,
    rules,
    actions: ["Record each decision", "Show overall outcome", "Write audit log"],
    approvalWhen: "Whenever any decision is REVIEW or BLOCK, or a required fact is missing.",
    workflow,
    edges: defaultDecisionEdges(workflow),
    aiReasoningEnabled: false,
    riskLevel,
    approvalLevel: "Human review when any decision is REVIEW or BLOCK",
    possibleOutcomes,
    generatedAt: createdAt,
    inputFields,
    decisions,
  };

  return {
    name,
    purpose,
    decisionType,
    riskLevel,
    approvalLevel: config.approvalLevel ?? "Human review when REVIEW",
    possibleOutcomes,
    status: "draft",
    createdAt,
    config,
  };
}
