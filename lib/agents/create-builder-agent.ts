import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentBuildView } from "@/lib/agent-builder/build-response";
import { buildAgentBuildViewFromParse } from "@/lib/agent-builder/build-response";
import { slugifyAgentId } from "@/lib/agent-builder/slug";
import { createAgentApiKey } from "@/lib/gateway/keys/service";
import { ensureOrganization } from "@/lib/organizations/ensure-organization";
import { requireOrganizationAdmin } from "@/lib/organizations/require-org-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ALLOWED_AGENT_TOOLS, type AllowedAgentTool } from "@/lib/xai/parse-agent-build";
import { insertAgentPolicy, insertBuilderAgent, resolveUniqueAgentSlug, updateBuilderAgent } from "./repository";
import type { CreateBuilderAgentInput } from "./types";
import { seedWorkflowSafetySettings } from "./workflow/seed";
import { syncAgentSchedule } from "./scheduling/sync-agent-schedule";
import { createAgentActivationProposal } from "./activation/approval";

export interface CreateBuilderAgentResult {
  agent: Awaited<ReturnType<typeof insertBuilderAgent>>;
  policy: Awaited<ReturnType<typeof insertAgentPolicy>>;
  apiKey: Awaited<ReturnType<typeof createAgentApiKey>>;
  spec: AgentBuildView["spec"];
  buildView: AgentBuildView;
}

export async function createBuilderAgent(
  supabase: SupabaseClient,
  params: {
    userId: string;
    userEmail: string;
    input: CreateBuilderAgentInput;
  }
): Promise<CreateBuilderAgentResult> {
  const organizationId = await ensureOrganization(
    supabase,
    params.userId,
    params.userEmail
  );

  await requireOrganizationAdmin(supabase, params.userId, organizationId);

  const admin = createAdminClient();
  const baseSlug = slugifyAgentId(params.input.name);
  const slug = await resolveUniqueAgentSlug(admin, organizationId, baseSlug);

  let agent = await insertBuilderAgent(admin, {
    userId: params.userId,
    organizationId,
    name: params.input.name.trim(),
    slug,
    description: params.input.description.trim(),
    source: params.input.source ?? "zelta-builder",
    tools: params.input.tools,
    triggerType: params.input.triggerType,
    suggestedThreshold: params.input.suggestedThreshold ?? null,
    goal: params.input.goal ?? params.input.description.trim(),
    instructions: params.input.instructions ?? null,
    model: params.input.model ?? null,
    capabilities: params.input.capabilities ?? [],
    schedule: params.input.schedule,
    timezone: params.input.timezone,
    memoryEnabled: params.input.memoryEnabled,
    safetySettings: params.input.safetySettings,
  });

  console.log("Created agent with ID:", agent.id);

  const seededSafety = seedWorkflowSafetySettings(agent);
  if (seededSafety !== agent.safetySettings) {
    await updateBuilderAgent(admin, {
      agentId: agent.id,
      userId: params.userId,
      patch: { safetySettings: seededSafety },
    });
    agent = { ...agent, safetySettings: seededSafety };
  }

  if (params.input.schedule && params.input.schedule.when && params.input.schedule.when !== "manual") {
    try {
      await syncAgentSchedule(admin, {
        agentId: agent.id,
        userId: params.userId,
        organizationId,
        schedule: params.input.schedule,
        timezone: params.input.timezone ?? "UTC",
        agentActive: false,
      });
    } catch (err) {
      console.warn("[scheduler] schedule sync on create skipped:", err);
    }
  }

  const policy = await insertAgentPolicy(admin, {
    agentId: agent.id,
    threshold: params.input.suggestedThreshold ?? null,
    autoAllow: params.input.autoAllow ?? true,
  });

  const specTools = params.input.tools.filter((tool): tool is AllowedAgentTool =>
    (ALLOWED_AGENT_TOOLS as readonly string[]).includes(tool)
  );

  const buildView = buildAgentBuildViewFromParse(
    {
      name: agent.slug,
      description: agent.description,
      tools: specTools.length > 0 ? specTools : ["send_email"],
      triggerType: params.input.triggerType,
      suggestedThreshold: params.input.suggestedThreshold ?? 5000,
    },
    agent.description
  );

  const apiKey = await createAgentApiKey(admin, {
    organizationId,
    agentId: agent.slug,
    name: buildView.spec.name,
    createdBy: params.userId,
    expiresAt: null,
  });

  try {
    await createAgentActivationProposal(admin, {
      agent,
      userId: params.userId,
    });
  } catch (err) {
    console.warn("[activation] failed to create approval on agent create", {
      agentId: agent.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    agent,
    policy,
    apiKey,
    spec: buildView.spec,
    buildView,
  };
}
