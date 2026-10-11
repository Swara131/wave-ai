import { getBuilderAgentForUserBySlug } from "@/lib/agents/save-builder-agent-draft";
import { updateBuilderAgent } from "@/lib/agents/repository";
import { resolveEvidenceFields } from "@/lib/agents/runtime/analysis/record-validation";
import {
  AGENT_DATA_SOURCE_KINDS,
  type AgentDataSourceConfig,
  type AgentDataSourceKind,
  type AgentFieldMapping,
} from "@/lib/agents/data-source/types";
import {
  GOOGLE_SHEETS_UNAVAILABLE_MESSAGE,
  readDataSourceConfig,
  writeDataSourceConfig,
} from "@/lib/agents/data-source/config";
import { dataSourceCapabilities, verifyAgentDataSource } from "@/lib/agents/data-source/verify-source";
import { loadAgentSourceRecords } from "@/lib/agents/data-source/load-records";
import { suggestFieldMapping } from "@/lib/agents/data-source/mapping";
import { parseJsonBody, secureError, secureJson } from "@/lib/security/api";
import { ValidationError } from "@/lib/security/errors";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

const mappingSchema = z.object({
  sourceColumn: z.string().max(120),
  targetField: z.string().max(80),
});

const putSchema = z.object({
  kind: z.enum(AGENT_DATA_SOURCE_KINDS),
  mapping: z.array(mappingSchema).max(40).optional(),
  sampleText: z.string().max(20_000).optional(),
});

export async function GET(_request: Request, context: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return secureError("Unauthorized", 401);

  const { agentId } = await context.params;
  const agent = await getBuilderAgentForUserBySlug(supabase, {
    userId: user.id,
    userEmail: user.email ?? "user@local",
    slug: agentId?.trim() ?? "",
  });
  if (!agent) return secureJson({ success: false, error: "Agent not found." }, { status: 404 });

  const config = readDataSourceConfig(agent);
  const evidenceFields = resolveEvidenceFields(agent);
  const admin = createAdminClient();
  let preview: { headers: string[]; rowCount: number; sampleRows: Record<string, unknown>[] } | null =
    null;
  try {
    const loaded = await loadAgentSourceRecords({
      supabase: admin,
      agent,
      userId: user.id,
      organizationId: agent.organizationId,
      limit: 5,
      skipMapping: true,
    });
    if (!loaded.unavailable) {
      preview = {
        headers: loaded.headers,
        rowCount: loaded.retrievedCount,
        sampleRows: loaded.rows.slice(0, 3),
      };
    }
  } catch {
    preview = null;
  }

  const sheetsRetired = config?.kind === "google_sheets";
  return secureJson({
    success: true,
    config,
    capabilities: dataSourceCapabilities(),
    evidenceFields,
    requiredTargets: evidenceFields.filter((field) => field.required).map((field) => field.key),
    suggestedMapping: suggestFieldMapping(preview?.headers ?? config?.headers ?? [], evidenceFields),
    preview: sheetsRetired ? null : preview,
    verified: Boolean(config?.verifiedAt) && !sheetsRetired,
    error: sheetsRetired ? GOOGLE_SHEETS_UNAVAILABLE_MESSAGE : undefined,
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return secureError("Unauthorized", 401);

  const { agentId } = await context.params;
  try {
    const body = await parseJsonBody(request, putSchema);
    if (body.kind === "google_sheets") {
      return secureJson({ success: false, error: GOOGLE_SHEETS_UNAVAILABLE_MESSAGE }, { status: 400 });
    }

    const agent = await getBuilderAgentForUserBySlug(supabase, {
      userId: user.id,
      userEmail: user.email ?? "user@local",
      slug: agentId?.trim() ?? "",
    });
    if (!agent) return secureJson({ success: false, error: "Agent not found." }, { status: 404 });

    const existing = readDataSourceConfig(agent);
    const kind = body.kind as AgentDataSourceKind;
    const mapping: AgentFieldMapping[] = body.mapping ?? existing?.mapping ?? [];
    const next: AgentDataSourceConfig = {
      kind,
      verifiedAt: null,
      lastError: null,
      isSample: kind === "manual_sample",
      mapping,
      headers: existing?.headers ?? [],
      rowCount: existing?.rowCount ?? null,
      csv: kind === "csv_upload" ? existing?.csv : undefined,
      manual:
        kind === "manual_sample"
          ? { raw: body.sampleText ?? existing?.manual?.raw ?? "" }
          : undefined,
    };

    const patched = await updateBuilderAgent(supabase, {
      agentId: agent.id,
      userId: user.id,
      patch: {
        safetySettings: writeDataSourceConfig(
          {
            ...agent.safetySettings,
            setupAnswers: {
              ...(agent.safetySettings.setupAnswers ?? {}),
              ticket_source: kind,
            },
          },
          next
        ),
      },
    });

    const verified = await verifyAgentDataSource({
      supabase: createAdminClient(),
      agent: patched,
      userId: user.id,
      organizationId: patched.organizationId,
    });

    const saved = await updateBuilderAgent(supabase, {
      agentId: agent.id,
      userId: user.id,
      patch: {
        safetySettings: writeDataSourceConfig(
          {
            ...patched.safetySettings,
            setupAnswers: {
              ...(patched.safetySettings.setupAnswers ?? {}),
              ticket_source: kind,
              data_source: verified.config.verifiedAt ? "verified" : "",
            },
          },
          verified.config
        ),
      },
    });

    return secureJson({
      success: Boolean(verified.config.verifiedAt),
      config: readDataSourceConfig(saved),
      error: verified.error,
      empty: verified.config.rowCount === 0,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return secureJson({ success: false, error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Could not save data source.";
    return secureJson({ success: false, error: message }, { status: 500 });
  }
}
