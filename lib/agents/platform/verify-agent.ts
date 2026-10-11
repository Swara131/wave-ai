import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deliveryModeDisplayLabel,
  isEmailDeliveryConnected,
  isWhatsAppDeliveryConnected,
  parseDeliverySettings,
  resolveDestinationPhone,
  shouldDeliverEmail,
  shouldDeliverWhatsApp,
} from "@/lib/agents/delivery/settings";
import {
  isWhatsAppContentTemplateConfigured,
  requiresWhatsAppContentTemplate,
} from "@/lib/whatsapp/env";
import { maskPhoneDisplay } from "@/lib/whatsapp/phone";
import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";
import { getAgentPolicyByAgentId } from "@/lib/agents/repository";
import { isWebSearchConfigured } from "@/lib/agents/tools/handlers/web-search";
import { getToolDefinition } from "@/lib/agents/tools/catalog";
import { toolConnectionsReady } from "@/lib/agents/tools/connections";
import { normalizeEnabledTools } from "@/lib/agents/tools/registry";
import { queryWorkspaceRecords } from "@/lib/agents/tools/handlers/query-supabase";
import {
  hasQueryDatabaseTool,
  resolveDatabaseQueryInput,
} from "@/lib/agents/runtime/data/resolve-query-source";
import type { LoadedAgent } from "@/lib/agents/runtime/types";
import { readWorkflowState } from "@/lib/agents/workflow/persistence";
import { activeWorkflowGraph } from "@/lib/agents/workflow/persistence";
import { validateWorkflowGraph } from "@/lib/agents/workflow/validate-workflow";
import {
  createDefaultPlatformLifecycle,
  type AgentPlatformLifecycle,
  type PlatformCheckResult,
} from "./lifecycle-types";

function checkConfiguration(agent: BuilderAgentRecord): PlatformCheckResult {
  const valid =
    agent.name.trim().length > 0 &&
    (agent.goal?.trim().length ?? 0) >= 10 &&
    agent.tools.length > 0;

  return {
    id: "configuration",
    label: "Configuration",
    status: valid ? "pass" : "fail",
    message: valid
      ? "Agent name, goal, and tools are configured."
      : "Agent is missing required configuration (name, goal, or tools).",
    fixHref: `/agents/${encodeURIComponent(agent.slug)}/edit`,
    fixLabel: "Edit agent",
    checkedAt: new Date().toISOString(),
  };
}

function checkWorkflow(agent: BuilderAgentRecord): PlatformCheckResult {
  const workflowState = readWorkflowState(agent.safetySettings);
  const graph = activeWorkflowGraph(workflowState);

  if (!graph) {
    return {
      id: "workflow",
      label: "Workflow",
      status: "needs_attention",
      message: "No workflow defined yet. Generate one from the agent builder.",
      fixHref: `/agents/${encodeURIComponent(agent.slug)}/edit`,
      fixLabel: "Open builder",
      checkedAt: new Date().toISOString(),
    };
  }

  const validation = validateWorkflowGraph(graph, {
    emailConnected: isEmailDeliveryConnected(),
    webSearchConnected: isWebSearchConfigured(),
  });

  return {
    id: "workflow",
    label: "Workflow",
    status: validation.valid ? "pass" : "fail",
    message: validation.valid
      ? "Workflow structure is valid."
      : validation.issues.find((issue) => issue.severity === "error")?.message ??
        "Workflow has validation issues.",
    fixHref: `/agents/${encodeURIComponent(agent.slug)}/edit`,
    fixLabel: "Fix workflow",
    checkedAt: new Date().toISOString(),
  };
}

function checkTools(agent: BuilderAgentRecord): PlatformCheckResult {
  const unknown = agent.tools.filter((tool) => !getToolDefinition(tool));

  return {
    id: "tools",
    label: "Tools",
    status: agent.tools.length > 0 && unknown.length === 0 ? "pass" : "fail",
    message:
      unknown.length > 0
        ? `Unsupported tools: ${unknown.join(", ")}`
        : agent.tools.length > 0
          ? `${agent.tools.length} tool(s) configured.`
          : "No tools configured.",
    fixHref: `/agents/${encodeURIComponent(agent.slug)}/edit`,
    fixLabel: "Configure tools",
    checkedAt: new Date().toISOString(),
  };
}

function checkConnections(agent: BuilderAgentRecord): PlatformCheckResult {
  const failures: string[] = [];
  let fixHref = "/settings?tab=integrations";

  for (const toolName of agent.tools) {
    const catalogTool = getToolDefinition(toolName);
    if (!catalogTool) continue;
    if (!toolConnectionsReady(catalogTool)) {
      failures.push(catalogTool.label);
      fixHref =
        catalogTool.permissions.find((item) => item.settingsPath)?.settingsPath ?? fixHref;
    }
  }

  const delivery = agent.safetySettings.delivery;
  if (
    (delivery?.mode === "email" || delivery?.mode === "both") &&
    !isEmailDeliveryConnected()
  ) {
    failures.push("Email provider");
    fixHref = "/settings?tab=integrations&provider=email";
  }

  return {
    id: "connections",
    label: "Connections",
    status: failures.length === 0 ? "pass" : "fail",
    message:
      failures.length === 0
        ? "Required integrations are connected."
        : `Missing connections: ${failures.join(", ")}`,
    fixHref,
    fixLabel: failures.length ? "Configure integration" : undefined,
    checkedAt: new Date().toISOString(),
  };
}

async function checkDatabase(
  supabase: SupabaseClient,
  agent: BuilderAgentRecord
): Promise<PlatformCheckResult | null> {
  const enabledTools = normalizeEnabledTools(agent.tools);
  if (!hasQueryDatabaseTool(enabledTools) && !hasQueryDatabaseTool(agent.tools)) {
    return null;
  }

  const loaded: LoadedAgent = {
    record: agent,
    gatewayAgentId: agent.slug,
    systemPrompt: "",
    enabledTools,
  };

  try {
    const outcome = await queryWorkspaceRecords(
      supabase,
      resolveDatabaseQueryInput({
        agent: loaded,
        task: agent.goal ?? agent.description,
        limit: 5,
      }),
      {
        agent: loaded,
        runId: null,
        userId: agent.userId,
        organizationId: agent.organizationId,
      }
    );

    const table =
      typeof outcome.output.table === "string" ? outcome.output.table : "configured source";
    const rowCount =
      typeof outcome.output.rowCount === "number" ? outcome.output.rowCount : 0;
    const tableAvailable = outcome.output.tableAvailable !== false;

    if (!outcome.executed || !tableAvailable) {
      const queryError = outcome.executed ? null : outcome.error;
      return {
        id: "database",
        label: "Database",
        status: "fail",
        message:
          queryError ??
          `Database table ${table} is missing or the query failed. Empty results are reported separately after the table is reachable.`,
        fixHref: `/agents/${encodeURIComponent(agent.slug)}/edit`,
        fixLabel: "Fix data source",
        checkedAt: new Date().toISOString(),
      };
    }

    if (rowCount === 0) {
      return {
        id: "database",
        label: "Database",
        status: "needs_attention",
        message: `Reached ${table}, but it is empty (0 records).`,
        checkedAt: new Date().toISOString(),
      };
    }

    return {
      id: "database",
      label: "Database",
      status: "pass",
      message: `Reached ${table} and found ${rowCount} accessible record(s).`,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      id: "database",
      label: "Database",
      status: "fail",
      message: err instanceof Error ? err.message : "Database access check failed.",
      checkedAt: new Date().toISOString(),
    };
  }
}

async function checkSafety(
  supabase: SupabaseClient,
  agent: BuilderAgentRecord
): Promise<PlatformCheckResult> {
  const policy = await getAgentPolicyByAgentId(supabase, agent.id);
  const hasPolicy = Boolean(policy);
  const hasMission = Boolean(agent.safetySettings.mission?.goal);

  const pass = hasPolicy || hasMission || agent.safetySettings.requireApprovalFor?.length;

  return {
    id: "safety",
    label: "Safety",
    status: pass ? "pass" : "needs_attention",
    message: pass
      ? "Safety policy and protection settings are configured."
      : "Safety policy is not fully configured.",
    fixHref: "/safety",
    fixLabel: "Open Safety",
    checkedAt: new Date().toISOString(),
  };
}

function checkNotifications(agent: BuilderAgentRecord): PlatformCheckResult {
  const delivery = parseDeliverySettings(agent.safetySettings);
  const mode = delivery.mode;

  if (mode === "none") {
    return {
      id: "notifications",
      label: "Notifications",
      status: "needs_attention",
      message: "No delivery channel configured.",
      fixHref: `/agents/${encodeURIComponent(agent.slug)}/test`,
      fixLabel: "Configure notifications",
      checkedAt: new Date().toISOString(),
    };
  }

  if (mode === "notification") {
    return {
      id: "notifications",
      label: "Notifications",
      status: "pass",
      message: "Wave in-app notification",
      checkedAt: new Date().toISOString(),
    };
  }

  const statusParts: string[] = [];

  if (shouldDeliverWhatsApp(mode)) {
    const phone = resolveDestinationPhone({ delivery });
    if (!phone) {
      return {
        id: "notifications",
        label: "Notifications",
        status: "needs_attention",
        message: "WhatsApp selected but no recipient number saved.",
        fixHref: `/agents/${encodeURIComponent(agent.slug)}/test`,
        fixLabel: "Add WhatsApp number",
        checkedAt: new Date().toISOString(),
      };
    }

    if (!isWhatsAppDeliveryConnected()) {
      return {
        id: "notifications",
        label: "Notifications",
        status: "fail",
        message: "WhatsApp not configured — add Twilio credentials in .env.local.",
        fixHref: "/settings?tab=integrations&provider=whatsapp",
        fixLabel: "Configure WhatsApp",
        checkedAt: new Date().toISOString(),
      };
    }

    if (requiresWhatsAppContentTemplate() && !isWhatsAppContentTemplateConfigured()) {
      return {
        id: "notifications",
        label: "Notifications",
        status: "needs_attention",
        message: `WhatsApp connected · Recipient: ${maskPhoneDisplay(phone)} · Content template required (TWILIO_WHATSAPP_CONTENT_SID)`,
        fixHref: "/settings?tab=integrations&provider=whatsapp",
        fixLabel: "Configure template",
        checkedAt: new Date().toISOString(),
      };
    }

    statusParts.push(`WhatsApp connected · Recipient: ${maskPhoneDisplay(phone)}`);
  }

  if (shouldDeliverEmail(mode)) {
    if (!isEmailDeliveryConnected()) {
      return {
        id: "notifications",
        label: "Notifications",
        status: "fail",
        message: "Email delivery not connected.",
        fixHref: "/settings?tab=integrations&provider=email",
        fixLabel: "Configure Email",
        checkedAt: new Date().toISOString(),
      };
    }
    statusParts.push("Email connected");
  }

  return {
    id: "notifications",
    label: "Notifications",
    status: "pass",
    message: statusParts.join(" · ") || `Delivery: ${deliveryModeDisplayLabel(mode)}`,
    checkedAt: new Date().toISOString(),
  };
}

export async function verifyAgentPlatform(
  supabase: SupabaseClient,
  agent: BuilderAgentRecord,
  options?: {
    executionCheck?: PlatformCheckResult;
    outputCheck?: PlatformCheckResult;
  }
): Promise<AgentPlatformLifecycle> {
  const databaseCheck = await checkDatabase(supabase, agent);
  const checks: PlatformCheckResult[] = [
    checkConfiguration(agent),
    checkWorkflow(agent),
    checkTools(agent),
    checkConnections(agent),
    ...(databaseCheck ? [databaseCheck] : []),
    options?.executionCheck ?? {
      id: "execution",
      label: "Execution",
      status: "not_run",
      message: "Run a full test to verify execution.",
      fixHref: `/agents/${encodeURIComponent(agent.slug)}/test`,
      fixLabel: "Test agent",
      checkedAt: null,
    },
    options?.outputCheck ?? {
      id: "output",
      label: "Output",
      status: "not_run",
      message: "Run a full test to verify output delivery.",
      fixHref: `/agents/${encodeURIComponent(agent.slug)}/test`,
      fixLabel: "Test agent",
      checkedAt: null,
    },
    await checkSafety(supabase, agent),
    checkNotifications(agent),
  ];

  const hasFailure = checks.some((check) => check.status === "fail");
  const hasAttention = checks.some((check) => check.status === "needs_attention");
  const allPass = checks.every((check) => check.status === "pass");

  let stage: AgentPlatformLifecycle["stage"] = "draft";
  if (allPass) stage = "verified";
  else if (hasFailure) stage = "needs_attention";
  else if (hasAttention) stage = "testing";

  const workflowState = readWorkflowState(agent.safetySettings);
  const hasDraft = Boolean(workflowState?.draft);

  const previous = agent.safetySettings.platformLifecycle as AgentPlatformLifecycle | undefined;
  const base = previous ?? createDefaultPlatformLifecycle();

  return {
    ...base,
    stage: allPass ? "verified" : hasFailure ? "needs_attention" : base.stage === "deployed" ? "deployed" : stage,
    checks,
    lastVerifiedAt: new Date().toISOString(),
    deployment: {
      ...base.deployment,
      hasUnpublishedDraft: hasDraft,
      draftVersion: hasDraft ? (base.deployment.version || 0) + 1 : base.deployment.draftVersion,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function isAgentReadyToDeploy(lifecycle: AgentPlatformLifecycle): boolean {
  const required = [
    "configuration",
    "workflow",
    "tools",
    "connections",
    "safety",
    "execution",
    "output",
  ];
  if (lifecycle.checks.some((item) => item.id === "database")) {
    required.push("database");
  }
  return required.every((id) => {
    const check = lifecycle.checks.find((item) => item.id === id);
    return check?.status === "pass";
  });
}
