import { getBuilderAgentForUserBySlug } from "@/lib/agents/save-builder-agent-draft";
import { updateBuilderAgent } from "@/lib/agents/repository";
import { writeDataSourceConfig, readDataSourceConfig } from "@/lib/agents/data-source/config";
import { parseTabularInput } from "@/lib/agents/data-source/parse-tabular";
import { suggestFieldMapping } from "@/lib/agents/data-source/mapping";
import { verifyAgentDataSource } from "@/lib/agents/data-source/verify-source";
import { resolveEvidenceFields } from "@/lib/agents/runtime/analysis/record-validation";
import { MAX_CSV_BYTES } from "@/lib/agents/data-source/types";
import { executeLogUpload, LogUploadError } from "@/lib/storage/log-uploads";
import { secureError, secureJson } from "@/lib/security/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return secureJson({ success: false, error: "Invalid upload request." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return secureJson({ success: false, error: "Choose a CSV or JSON file." }, { status: 400 });
  }
  if (file.size > MAX_CSV_BYTES) {
    return secureJson({ success: false, error: "File exceeds the 2 MB agent-data limit." }, { status: 400 });
  }

  const name = file.name.toLowerCase();
  if (!name.endsWith(".csv") && !name.endsWith(".json") && !name.endsWith(".txt")) {
    return secureJson(
      { success: false, error: "Upload a CSV or JSON file of ticket records." },
      { status: 400 }
    );
  }

  try {
    const text = await file.text();
    const parsed = parseTabularInput(text);
    if (parsed.headers.length === 0) {
      return secureJson({ success: false, error: "The file has no header row." }, { status: 400 });
    }

    let uploadId = "";
    let storagePath = "";
    let storedFilename = file.name;
    try {
      const record = await executeLogUpload(supabase, file);
      if (!record.storagePath?.startsWith(`${user.id}/`)) {
        return secureJson(
          { success: false, error: "Upload was stored outside your user folder." },
          { status: 500 }
        );
      }
      uploadId = record.id;
      storagePath = record.storagePath;
      storedFilename = record.filename;
    } catch (err) {
      if (!(err instanceof LogUploadError)) throw err;
      const message = err.message.toLowerCase();
      const storageUnavailable =
        message.includes("bucket") ||
        message.includes("row-level security") ||
        message.includes("storage permission");
      if (!storageUnavailable) throw err;
    }

    const fields = resolveEvidenceFields(agent);
    const mapping = suggestFieldMapping(parsed.headers, fields);
    const saved = await updateBuilderAgent(supabase, {
      agentId: agent.id,
      userId: user.id,
      patch: {
        safetySettings: writeDataSourceConfig(
          {
            ...agent.safetySettings,
            setupAnswers: {
              ...(agent.safetySettings.setupAnswers ?? {}),
              ticket_source: "csv_upload",
            },
          },
          {
            kind: "csv_upload",
            verifiedAt: null,
            lastError: null,
            isSample: false,
            mapping,
            headers: parsed.headers,
            rowCount: parsed.rows.length,
            csv: {
              uploadId,
              filename: storedFilename,
              storagePath,
              inlineText: text,
            },
          }
        ),
      },
    });

    const verified = await verifyAgentDataSource({
      supabase: createAdminClient(),
      agent: saved,
      userId: user.id,
      organizationId: saved.organizationId,
    });
    const finalized = await updateBuilderAgent(supabase, {
      agentId: agent.id,
      userId: user.id,
      patch: {
        safetySettings: writeDataSourceConfig(
          {
            ...saved.safetySettings,
            setupAnswers: {
              ...(saved.safetySettings.setupAnswers ?? {}),
              ticket_source: "csv_upload",
              data_source: verified.config.verifiedAt ? "verified" : "",
            },
          },
          verified.config
        ),
      },
    });

    return secureJson({
      success: true,
      config: readDataSourceConfig(finalized),
      headers: parsed.headers,
      rowCount: parsed.rows.length,
      empty: parsed.rows.length === 0,
      verified: Boolean(verified.config.verifiedAt),
      error: verified.error,
    });
  } catch (err) {
    const message =
      err instanceof LogUploadError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Upload failed.";
    return secureJson({ success: false, error: message }, { status: 500 });
  }
}
