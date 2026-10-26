export type TechStackId = "nodejs" | "python" | "custom-http" | "langchain";

export const WIZARD_STEP_LABELS = [
  "Choose",
  "Copy key",
  "Code",
  "Test",
] as const;

export interface TechStackOption {
  id: TechStackId;
  label: string;
  shortLabel: string;
  description: string;
  popular?: boolean;
}

export const TECH_STACK_OPTIONS: readonly TechStackOption[] = [
  {
    id: "nodejs",
    label: "Node.js / Express",
    shortLabel: "Node.js",
    description: "JavaScript or TypeScript agents using axios or fetch.",
    popular: true,
  },
  {
    id: "python",
    label: "Python / FastAPI",
    shortLabel: "Python",
    description: "Python services with requests or httpx.",
  },
  {
    id: "custom-http",
    label: "Custom HTTP",
    shortLabel: "Custom HTTP",
    description: "Any stack that can send HTTP POST requests.",
  },
  {
    id: "langchain",
    label: "LangChain",
    shortLabel: "LangChain",
    description: "LangChain or LangGraph tools wrapped with Wave.",
  },
] as const;

export interface ConnectionTestTool {
  id: string;
  toolName: string;
  label: string;
  actionId: "send_email" | "issue_refund" | "delete_record";
  payloadTemplate: string;
  reason: string;
  amountInr?: number;
}

export const CONNECTION_TEST_TOOLS: readonly ConnectionTestTool[] = [
  {
    id: "send_email",
    toolName: "send_email",
    label: "send_email",
    actionId: "send_email",
    reason: "Send order update to customer",
    payloadTemplate: `{
  "to": "customer@example.com",
  "subject": "Order update",
  "body": "Your refund is being processed."
}`,
  },
  {
    id: "issue_refund",
    toolName: "issue_refund",
    label: "issue_refund",
    actionId: "issue_refund",
    reason: "Customer requested a refund for a cancelled order",
    amountInr: 2_000,
    payloadTemplate: `{
  "customerId": "cus_demo",
  "amount": 200000,
  "currency": "INR"
}`,
  },
  {
    id: "issue_refund_large",
    toolName: "issue_refund",
    label: "issue_refund (high value)",
    actionId: "issue_refund",
    reason: "Customer requested a refund for a delayed shipment",
    amountInr: 25_000,
    payloadTemplate: `{
  "customerId": "cus_demo",
  "amount": 2500000,
  "currency": "INR"
}`,
  },
  {
    id: "delete_record",
    toolName: "delete_record",
    label: "delete_record",
    actionId: "delete_record",
    reason: "Remove inactive customer account",
    payloadTemplate: `{
  "customerId": "cus_demo",
  "recordType": "customer_profile"
}`,
  },
] as const;

export interface CodeSnippetSegment {
  text: string;
  /** Yellow highlight — user must customize */
  customize?: boolean;
  /** Syntax token class from globals.css */
  token?: string;
}

export interface ConnectionSetupSnippetParams {
  agentId: string;
  apiKeyPlaceholder: string;
  baseUrl?: string;
}

export function mapPlatformToTechStack(platform: string | null): TechStackId | null {
  switch (platform) {
    case "langchain":
      return "langchain";
    case "python":
      return "python";
    case "custom":
    case "custom-http":
    case "other-platform":
    case "other":
    case "n8n":
      return "custom-http";
    case "zelta":
    case "nodejs":
      return "nodejs";
    default:
      return null;
  }
}

export function getTechStackOption(id: TechStackId): TechStackOption {
  return TECH_STACK_OPTIONS.find((option) => option.id === id) ?? TECH_STACK_OPTIONS[0];
}

export function buildConnectionCodePlainText(
  stack: TechStackId,
  params: ConnectionSetupSnippetParams
): string {
  return buildConnectionCodeSegments(stack, params)
    .map((segment) => segment.text)
    .join("");
}

export function buildConnectionCodeSegments(
  stack: TechStackId,
  params: ConnectionSetupSnippetParams
): CodeSnippetSegment[] {
  const agent = params.agentId || "your-agent-id";
  const key = params.apiKeyPlaceholder || "YOUR_ZELTA_API_KEY";
  const base = (params.baseUrl ?? "https://api.zelta.com").replace(/\/+$/, "");

  switch (stack) {
    case "nodejs":
      return buildNodeSegments(agent, key, base);
    case "python":
      return buildPythonSegments(agent, key, base);
    case "custom-http":
      return buildCustomHttpSegments(agent, key, base);
    case "langchain":
      return buildLangChainSegments(agent, key, base);
  }
}

function buildNodeSegments(agent: string, key: string, base: string): CodeSnippetSegment[] {
  const code = `const axios = require('axios');

async function proposeAction(toolName, payload) {
  const response = await axios.post(
    '${base}/api/v1/actions/propose',
    {
      agentId: '${agent}',
      toolName: toolName,
      actionType: toolName,
      payload: payload
    },
    {
      headers: {
        'Authorization': \`Bearer \${process.env.ZELTA_API_KEY}\`
      }
    }
  );

  if (response.data.decision === 'allow') {
    return await executeAction(toolName, payload);
  } else if (response.data.decision === 'approval_required') {
    return await waitForApproval(response.data.actionId);
  } else {
    throw new Error('Action blocked by policy');
  }
}`;

  return tokenizeJsLike(code, agent, key);
}

function buildPythonSegments(agent: string, key: string, base: string): CodeSnippetSegment[] {
  const code = `import os
import requests

def propose_action(tool_name: str, payload: dict):
    response = requests.post(
        "${base}/api/v1/actions/propose",
        headers={
            "Authorization": f"Bearer {os.environ['ZELTA_API_KEY']}",
            "Content-Type": "application/json",
        },
        json={
            "agentId": "${agent}",
            "toolName": tool_name,
            "actionType": tool_name,
            "payload": payload,
        },
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()

    if data["decision"] == "allow":
        return execute_action(tool_name, payload)
    if data["decision"] == "approval_required":
        return wait_for_approval(data["actionId"])
    raise RuntimeError("Action blocked by policy")`;

  return tokenizePythonLike(code, agent, key);
}

function buildCustomHttpSegments(agent: string, key: string, base: string): CodeSnippetSegment[] {
  const code = `curl -X POST "${base}/api/v1/actions/propose" \\
  -H "Authorization: Bearer $ZELTA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentId": "${agent}",
    "toolName": "send_email",
    "actionType": "send_email",
    "payload": {
      "to": "customer@example.com",
      "subject": "Order update"
    }
  }'`;

  return tokenizeShellLike(code, agent, key);
}

function buildLangChainSegments(agent: string, key: string, base: string): CodeSnippetSegment[] {
  const code = `from langchain.tools import tool
import os, requests

ZELTA_BASE = "${base}"
ZELTA_KEY = os.environ["ZELTA_API_KEY"]
AGENT_ID = "${agent}"

def zelta_gate(tool_name: str, payload: dict) -> dict:
    r = requests.post(
        f"{ZELTA_BASE}/api/v1/actions/propose",
        headers={"Authorization": f"Bearer {ZELTA_KEY}"},
        json={"agentId": AGENT_ID, "toolName": tool_name, "actionType": tool_name, "payload": payload},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()

@tool
def send_customer_email(to: str, subject: str, body: str) -> str:
    decision = zelta_gate("send_email", {"to": to, "subject": subject, "body": body})
    if decision["decision"] != "allow":
        return f"Held by Wave: {decision['decision']}"
    # ... execute email send
    return "Email sent"`;

  return tokenizePythonLike(code, agent, key);
}

function tokenizeJsLike(code: string, agent: string, key: string): CodeSnippetSegment[] {
  return splitByCustomValues(code, agent, key, {
    keyword: "syntax-key",
    string: "syntax-string",
    comment: "",
  });
}

function tokenizePythonLike(code: string, agent: string, key: string): CodeSnippetSegment[] {
  return splitByCustomValues(code, agent, key, {
    keyword: "syntax-key",
    string: "syntax-string",
    comment: "",
  });
}

function tokenizeShellLike(code: string, agent: string, key: string): CodeSnippetSegment[] {
  return splitByCustomValues(code, agent, key, {
    keyword: "syntax-action",
    string: "syntax-string",
    comment: "",
  });
}

function splitByCustomValues(
  code: string,
  agent: string,
  key: string,
  tokens: { keyword: string; string: string; comment: string }
): CodeSnippetSegment[] {
  const segments: CodeSnippetSegment[] = [];
  const parts = code.split(new RegExp(`(${escapeRegex(agent)}|ZELTA_API_KEY|YOUR_ZELTA_API_KEY|your-agent-id)`, "g"));

  for (const part of parts) {
    if (!part) continue;
    if (part === agent || part === "your-agent-id") {
      segments.push({ text: part, customize: true, token: "syntax-id" });
      continue;
    }
    if (part === "ZELTA_API_KEY" || part === "YOUR_ZELTA_API_KEY") {
      segments.push({ text: part, customize: true, token: "syntax-string" });
      continue;
    }

    const lines = part.split("\n");
    lines.forEach((line, index) => {
      if (index > 0) segments.push({ text: "\n" });
      if (!line) return;

      const stringMatch = line.match(/^(\s*)('[^']*'|"[^"]*")(.*)$/);
      if (stringMatch) {
        segments.push({ text: stringMatch[1] });
        segments.push({ text: stringMatch[2], token: tokens.string });
        const rest = stringMatch[3];
        if (rest) segments.push({ text: rest });
        return;
      }

      const keywordMatch = line.match(
        /^(async |const |import |from |def |if |else |return |throw |raise |class )/
      );
      if (keywordMatch) {
        segments.push({ text: keywordMatch[0], token: tokens.keyword });
        segments.push({ text: line.slice(keywordMatch[0].length) });
        return;
      }

      segments.push({ text: line });
    });
  }

  return segments;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildEnvExportSnippet(apiKey: string): string {
  return `export ZELTA_API_KEY=${apiKey}`;
}

export function formatSafetyDecision(decision: "ALLOW" | "REVIEW" | "BLOCK"): string {
  switch (decision) {
    case "ALLOW":
      return "allow";
    case "REVIEW":
      return "approval_required";
    case "BLOCK":
      return "block";
  }
}
