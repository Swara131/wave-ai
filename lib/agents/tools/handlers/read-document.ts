import { createAdminClient } from "@/lib/supabase/admin";
import { LOG_UPLOADS_BUCKET } from "@/lib/storage/constants";
import { readDataSourceConfig } from "@/lib/agents/data-source/config";
import type { ToolExecutionOutcome, ToolHandlerContext } from "../../runtime/types";

const MAX_BYTES = 64_768;
const PLACEHOLDER_IDS = new Set(["latest", "last", "current", "newest"]);

export const MISSING_DOCUMENT_ERROR =
  "No file is uploaded for this agent. Upload a document or CSV in Prepare, then run this test again.";

function trimString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isPlaceholderDocumentId(value: string | null): boolean {
  if (!value) return true;
  return PLACEHOLDER_IDS.has(value.toLowerCase());
}

export type ResolvedDocumentTarget = {
  uploadId: string | null;
  storagePath: string | null;
  filename: string | null;
  inlineText: string | null;
  isSample: boolean;
  lookupLatestUpload: boolean;
};

export function resolveReadDocumentTarget(
  input: Record<string, unknown>,
  context: ToolHandlerContext
): ResolvedDocumentTarget {
  const rawId = trimString(input.uploadId) || trimString(input.documentId);
  const storagePath = trimString(input.storagePath);
  const explicitId = rawId && !isPlaceholderDocumentId(rawId) ? rawId : null;

  if (explicitId || storagePath) {
    return {
      uploadId: explicitId,
      storagePath,
      filename: null,
      inlineText: null,
      isSample: false,
      lookupLatestUpload: false,
    };
  }

  const dataSource = readDataSourceConfig(context.agent.record);
  if (dataSource?.kind === "csv_upload" && dataSource.csv) {
    const csvId = trimString(dataSource.csv.uploadId);
    const csvPath = trimString(dataSource.csv.storagePath);
    const inline = trimString(dataSource.csv.inlineText);
    if (csvId || csvPath || inline) {
      return {
        uploadId: csvId && !isPlaceholderDocumentId(csvId) ? csvId : null,
        storagePath: csvPath,
        filename: trimString(dataSource.csv.filename) ?? "upload.csv",
        inlineText: inline,
        isSample: dataSource.isSample,
        lookupLatestUpload: false,
      };
    }
  }

  if (dataSource?.kind === "manual_sample") {
    const raw = trimString(dataSource.manual?.raw);
    if (raw) {
      return {
        uploadId: null,
        storagePath: null,
        filename: "sample-data.txt",
        inlineText: raw,
        isSample: true,
        lookupLatestUpload: false,
      };
    }
  }

  return {
    uploadId: null,
    storagePath: null,
    filename: null,
    inlineText: null,
    isSample: false,
    lookupLatestUpload: true,
  };
}

function textOutcome(params: {
  filename: string;
  content: string;
  storagePath?: string | null;
  isSample: boolean;
}): ToolExecutionOutcome {
  const truncated = Buffer.byteLength(params.content, "utf8") > MAX_BYTES;
  const content =
    truncated ? params.content.slice(0, MAX_BYTES) : params.content;
  return {
    executed: true,
    output: {
      filename: params.filename,
      storagePath: params.storagePath ?? null,
      byteLength: Buffer.byteLength(params.content, "utf8"),
      truncated,
      content,
      isSample: params.isSample,
    },
  };
}

export async function handleReadDocument(
  input: Record<string, unknown>,
  context: ToolHandlerContext
): Promise<ToolExecutionOutcome> {
  const target = resolveReadDocumentTarget(input, context);

  if (target.inlineText && !target.uploadId && !target.storagePath) {
    return textOutcome({
      filename: target.filename ?? "document",
      content: target.inlineText,
      isSample: target.isSample,
    });
  }

  if (!target.uploadId && !target.storagePath && !target.lookupLatestUpload) {
    return {
      executed: false,
      error: MISSING_DOCUMENT_ERROR,
      output: {},
    };
  }

  try {
    const admin = createAdminClient();

    let path = target.storagePath;
    let filename = target.filename ?? "document";
    let uploadId = target.uploadId;

    if (target.lookupLatestUpload && !uploadId && !path) {
      const { data: latest, error: latestError } = await admin
        .from("uploaded_logs")
        .select("id, filename, storage_path, user_id")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestError) {
        return {
          executed: false,
          error: latestError.message,
          output: {},
        };
      }

      if (latest) {
        const ownerId = typeof latest.user_id === "string" ? latest.user_id : null;
        const storagePathValue =
          typeof latest.storage_path === "string" ? latest.storage_path : null;
        const filenameValue = typeof latest.filename === "string" ? latest.filename : null;
        if (ownerId === context.userId && storagePathValue && filenameValue) {
          uploadId = typeof latest.id === "string" ? latest.id : null;
          path = storagePathValue;
          filename = filenameValue;
        }
      }
    }

    if (uploadId && !path) {
      const { data: row, error } = await admin
        .from("uploaded_logs")
        .select("id, filename, storage_path, user_id")
        .eq("id", uploadId)
        .maybeSingle();

      if (error || !row) {
        if (target.inlineText) {
          return textOutcome({
            filename: target.filename ?? "document",
            content: target.inlineText,
            isSample: target.isSample,
          });
        }
        return {
          executed: false,
          error: error?.message ?? "Document not found.",
          output: { uploadId },
        };
      }

      const ownerId = typeof row.user_id === "string" ? row.user_id : null;
      const storagePathValue =
        typeof row.storage_path === "string" ? row.storage_path : null;
      const filenameValue = typeof row.filename === "string" ? row.filename : null;
      if (!ownerId || !storagePathValue || !filenameValue) {
        return {
          executed: false,
          error: "Document record is incomplete.",
          output: { uploadId },
        };
      }

      if (ownerId !== context.userId) {
        return {
          executed: false,
          error: "You do not have access to this document.",
          output: { uploadId },
        };
      }

      path = storagePathValue;
      filename = filenameValue;
    } else if (path && !path.startsWith(`${context.userId}/`)) {
      return {
        executed: false,
        error: "You do not have access to this document path.",
        output: { storagePath: path },
      };
    }

    if (!path) {
      if (target.inlineText) {
        return textOutcome({
          filename: target.filename ?? "document",
          content: target.inlineText,
          isSample: target.isSample,
        });
      }
      return {
        executed: false,
        error: MISSING_DOCUMENT_ERROR,
        output: { uploadId, storagePath: path },
      };
    }

    const { data: blob, error: downloadError } = await admin.storage
      .from(LOG_UPLOADS_BUCKET)
      .download(path);

    if (downloadError || !blob) {
      if (target.inlineText) {
        return textOutcome({
          filename,
          content: target.inlineText,
          storagePath: path,
          isSample: target.isSample,
        });
      }
      return {
        executed: false,
        error: downloadError?.message ?? "Failed to download document.",
        output: { storagePath: path },
      };
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    const truncated = buffer.length > MAX_BYTES;
    const text = buffer.subarray(0, MAX_BYTES).toString("utf8");

    return {
      executed: true,
      output: {
        filename,
        storagePath: path,
        byteLength: buffer.length,
        truncated,
        content: text,
        isSample: target.isSample,
      },
    };
  } catch (err) {
    if (target.inlineText) {
      return textOutcome({
        filename: target.filename ?? "document",
        content: target.inlineText,
        storagePath: target.storagePath,
        isSample: target.isSample,
      });
    }
    return {
      executed: false,
      error: err instanceof Error ? err.message : "Document read failed.",
      output: { uploadId: target.uploadId, storagePath: target.storagePath },
    };
  }
}
