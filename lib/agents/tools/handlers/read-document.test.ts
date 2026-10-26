import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";
import type { LoadedAgent, ToolHandlerContext } from "@/lib/agents/runtime/types";
import {
  handleReadDocument,
  isPlaceholderDocumentId,
  MISSING_DOCUMENT_ERROR,
  resolveReadDocumentTarget,
} from "./read-document";

function agent(dataSource: BuilderAgentRecord["safetySettings"]["dataSource"]): BuilderAgentRecord {
  return {
    id: "agent-1",
    userId: "user-1",
    organizationId: "org-1",
    name: "File Agent",
    slug: "file-agent",
    description: "Read files",
    goal: "Read uploaded documents",
    instructions: null,
    model: null,
    source: "test",
    tools: ["read_document"],
    capabilities: [],
    triggerType: "webhook",
    schedule: {},
    timezone: "UTC",
    memoryEnabled: false,
    safetySettings: { dataSource },
    suggestedThreshold: null,
    status: "testing",
    publishedAt: null,
    createdAt: "",
    updatedAt: "",
  };
}

function context(record: BuilderAgentRecord): ToolHandlerContext {
  const loaded: LoadedAgent = {
    record,
    gatewayAgentId: record.slug,
    systemPrompt: "test",
    enabledTools: record.tools,
  };
  return {
    agent: loaded,
    runId: null,
    userId: record.userId,
    organizationId: record.organizationId,
  };
}

describe("resolveReadDocumentTarget", () => {
  it("treats latest as a placeholder, not an upload id", () => {
    assert.equal(isPlaceholderDocumentId("latest"), true);
    assert.equal(isPlaceholderDocumentId("abc-real-id"), false);
  });

  it("uses the agent's CSV when the model passes latest", () => {
    const ctx = context(
      agent({
        kind: "csv_upload",
        verifiedAt: "2026-10-22T00:00:00.000Z",
        lastError: null,
        isSample: false,
        mapping: [],
        headers: ["ticket_id"],
        rowCount: 1,
        csv: {
          uploadId: "upload-1",
          filename: "tickets.csv",
          storagePath: "user-1/tickets.csv",
          inlineText: "ticket_id\nTKT-1",
        },
      })
    );
    const target = resolveReadDocumentTarget({ documentId: "latest" }, ctx);
    assert.equal(target.uploadId, "upload-1");
    assert.equal(target.storagePath, "user-1/tickets.csv");
    assert.equal(target.lookupLatestUpload, false);
  });

  it("uses verified sample rows when no file id is provided", () => {
    const ctx = context(
      agent({
        kind: "manual_sample",
        verifiedAt: "2026-10-22T00:00:00.000Z",
        lastError: null,
        isSample: true,
        mapping: [],
        headers: ["ticket_id"],
        rowCount: 1,
        manual: { raw: "ticket_id\nTKT-1" },
      })
    );
    const target = resolveReadDocumentTarget({}, ctx);
    assert.equal(target.inlineText, "ticket_id\nTKT-1");
    assert.equal(target.isSample, true);
    assert.equal(target.lookupLatestUpload, false);
  });

  it("asks for the latest upload when nothing is configured", () => {
    const ctx = context(agent(undefined));
    const target = resolveReadDocumentTarget({ documentId: "latest" }, ctx);
    assert.equal(target.lookupLatestUpload, true);
    assert.equal(target.uploadId, null);
  });
});

describe("handleReadDocument", () => {
  it("returns sample content without calling storage", async () => {
    const ctx = context(
      agent({
        kind: "manual_sample",
        verifiedAt: "2026-10-22T00:00:00.000Z",
        lastError: null,
        isSample: true,
        mapping: [],
        headers: ["ticket_id"],
        rowCount: 1,
        manual: { raw: "ticket_id\nTKT-9" },
      })
    );
    const result = await handleReadDocument({ documentId: "latest" }, ctx);
    assert.equal(result.executed, true);
    assert.equal(result.output.content, "ticket_id\nTKT-9");
    assert.equal(result.output.isSample, true);
  });

  it("returns CSV inline text when no storage path is set", async () => {
    const ctx = context(
      agent({
        kind: "csv_upload",
        verifiedAt: "2026-10-22T00:00:00.000Z",
        lastError: null,
        isSample: false,
        mapping: [],
        headers: ["ticket_id"],
        rowCount: 1,
        csv: {
          uploadId: "",
          filename: "tickets.csv",
          storagePath: "",
          inlineText: "ticket_id\nTKT-2",
        },
      })
    );
    const result = await handleReadDocument({}, ctx);
    assert.equal(result.executed, true);
    assert.equal(result.output.filename, "tickets.csv");
    assert.equal(result.output.content, "ticket_id\nTKT-2");
  });

  it("does not treat latest as a missing upload id when no file exists", async () => {
    const ctx = context(agent(undefined));
    const target = resolveReadDocumentTarget({ documentId: "latest" }, ctx);
    assert.equal(target.uploadId, null);
    assert.notEqual(MISSING_DOCUMENT_ERROR, "read_document requires uploadId or storagePath.");
  });
});
