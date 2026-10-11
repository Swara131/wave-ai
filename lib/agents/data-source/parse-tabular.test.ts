import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsvText, parseTabularInput, sheetValuesToRecords } from "./parse-tabular";
import { applyFieldMapping, suggestFieldMapping, validateFieldMapping } from "./mapping";
import { loadAgentSourceRecords } from "./load-records";
import type { BuilderAgentRecord } from "@/lib/agents/runtime-types";
import type { SupabaseClient } from "@supabase/supabase-js";

const fields = [
  { key: "ticket_id", label: "ticket ID", required: true, kind: "string" as const },
  { key: "customer_id", label: "customer ID", required: true, kind: "string" as const },
];

describe("tabular parsing and mapping", () => {
  it("parses CSV headers and rows without inventing values", () => {
    const parsed = parseCsvText("ticket_id,customer_id\nTKT-1,cus_1\nTKT-2,cus_2");
    assert.deepEqual(parsed.headers, ["ticket_id", "customer_id"]);
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0]?.ticket_id, "TKT-1");
  });

  it("parses JSON sample arrays", () => {
    const parsed = parseTabularInput(
      JSON.stringify([{ ticket_id: "TKT-9", customer_id: "cus_9" }]),
      { sample: true }
    );
    assert.equal(parsed.rows[0]?.ticket_id, "TKT-9");
  });

  it("converts sheet values to records", () => {
    const parsed = sheetValuesToRecords([
      ["Ticket ID", "Customer"],
      ["A-1", "Ada"],
    ]);
    assert.equal(parsed.rows[0]?.["Ticket ID"], "A-1");
  });

  it("suggests and validates column mapping", () => {
    const headers = ["Ticket ID", "customer_id"];
    const mapping = suggestFieldMapping(headers, fields);
    assert.equal(mapping.find((item) => item.targetField === "ticket_id")?.sourceColumn, "Ticket ID");
    assert.equal(mapping.find((item) => item.targetField === "customer_id")?.sourceColumn, "customer_id");
    const errors = validateFieldMapping(
      [{ targetField: "ticket_id", sourceColumn: "" }, { targetField: "customer_id", sourceColumn: "customer_id" }],
      fields,
      headers
    );
    assert.ok(errors.some((error) => /ticket ID/i.test(error)));
  });

  it("maps standard ticket headers one-to-one without sharing columns", () => {
    const ticketFields = [
      { key: "ticket_id", label: "ticket ID", required: true, kind: "string" as const },
      { key: "customer_id", label: "customer ID", required: true, kind: "string" as const },
      { key: "customer_name", label: "customer name", required: true, kind: "string" as const },
      {
        key: "resolution_details",
        label: "incident evidence / resolution details",
        required: true,
        kind: "string" as const,
      },
      { key: "satisfaction_rating", label: "satisfaction rating", required: true, kind: "integer_1_5" as const },
    ];
    const headers = [
      "ticket_id",
      "customer_id",
      "customer_name",
      "resolution_details",
      "satisfaction_rating",
    ];
    const mapping = suggestFieldMapping(headers, ticketFields);
    assert.deepEqual(
      Object.fromEntries(mapping.map((item) => [item.targetField, item.sourceColumn])),
      {
        ticket_id: "ticket_id",
        customer_id: "customer_id",
        customer_name: "customer_name",
        resolution_details: "resolution_details",
        satisfaction_rating: "satisfaction_rating",
      }
    );
  });

  it("does not map ticket ID to customer_id", () => {
    const mapping = suggestFieldMapping(["customer_id", "customer_name"], fields);
    assert.equal(mapping.find((item) => item.targetField === "ticket_id")?.sourceColumn, "");
    assert.equal(mapping.find((item) => item.targetField === "customer_id")?.sourceColumn, "customer_id");
  });

  it("applies mapping to real row keys only", () => {
    const mapped = applyFieldMapping(
      [{ "Ticket ID": "TKT-1", extra: "nope" }],
      [{ sourceColumn: "Ticket ID", targetField: "ticket_id" }]
    );
    assert.equal(mapped[0]?.ticket_id, "TKT-1");
    assert.equal(mapped[0]?.extra, undefined);
  });
});

function sampleAgent(): BuilderAgentRecord {
  return {
    id: "agent-1",
    userId: "user-1",
    organizationId: "org-1",
    name: "Support Ticket Evidence Agent",
    slug: "support-ticket-evidence",
    description: "Validate ticket evidence",
    goal: "Analyze support tickets and validate incident evidence.",
    instructions: null,
    model: null,
    source: "test",
    tools: ["query_supabase"],
    capabilities: [],
    triggerType: "webhook",
    schedule: {},
    timezone: "UTC",
    memoryEnabled: false,
    safetySettings: {
      dataSource: {
        kind: "manual_sample",
        verifiedAt: new Date().toISOString(),
        lastError: null,
        isSample: true,
        mapping: [
          { sourceColumn: "ticket_id", targetField: "ticket_id" },
          { sourceColumn: "customer_id", targetField: "customer_id" },
          { sourceColumn: "customer_name", targetField: "customer_name" },
          { sourceColumn: "resolution_details", targetField: "resolution_details" },
          { sourceColumn: "satisfaction_rating", targetField: "satisfaction_rating" },
        ],
        headers: ["ticket_id", "customer_id", "customer_name", "resolution_details", "satisfaction_rating"],
        rowCount: 1,
        manual: {
          raw: "ticket_id,customer_id,customer_name,resolution_details,satisfaction_rating\nTKT-1,cus_1,Ada,Server logs attached,5",
        },
      },
    },
    suggestedThreshold: 5000,
    status: "testing",
    publishedAt: null,
    createdAt: "",
    updatedAt: "",
  };
}

describe("loadAgentSourceRecords", () => {
  it("loads mapped sample rows without fabricating extras", async () => {
    const loaded = await loadAgentSourceRecords({
      supabase: {} as SupabaseClient,
      agent: sampleAgent(),
      userId: "user-1",
      organizationId: "org-1",
    });
    assert.equal(loaded.unavailable, false);
    assert.equal(loaded.isSample, true);
    assert.equal(loaded.retrievedCount, 1);
    assert.equal(loaded.rows[0]?.ticket_id, "TKT-1");
    assert.match(loaded.sourceLabel, /sample/i);
  });

  it("loads an uploaded CSV from inline text when object storage is not used", async () => {
    const agent = sampleAgent();
    agent.safetySettings.dataSource = {
      kind: "csv_upload",
      verifiedAt: null,
      lastError: null,
      isSample: false,
      mapping: [
        { sourceColumn: "ticket_id", targetField: "ticket_id" },
        { sourceColumn: "customer_id", targetField: "customer_id" },
        { sourceColumn: "customer_name", targetField: "customer_name" },
        { sourceColumn: "resolution_details", targetField: "resolution_details" },
        { sourceColumn: "satisfaction_rating", targetField: "satisfaction_rating" },
      ],
      headers: ["ticket_id", "customer_id", "customer_name", "resolution_details", "satisfaction_rating"],
      rowCount: 1,
      csv: {
        uploadId: "",
        filename: "tickets.csv",
        storagePath: "",
        inlineText:
          "ticket_id,customer_id,customer_name,resolution_details,satisfaction_rating\nTKT-77,cus_77,Ada,Server logs attached,5",
      },
    };
    const loaded = await loadAgentSourceRecords({
      supabase: {} as SupabaseClient,
      agent,
      userId: "user-1",
      organizationId: "org-1",
    });
    assert.equal(loaded.unavailable, false);
    assert.equal(loaded.isSample, false);
    assert.equal(loaded.rows[0]?.ticket_id, "TKT-77");
  });

  it("reports empty sample data without inventing tickets", async () => {
    const agent = sampleAgent();
    agent.safetySettings.dataSource = {
      ...agent.safetySettings.dataSource!,
      manual: { raw: "ticket_id,customer_id,customer_name,resolution_details,satisfaction_rating" },
      rowCount: 0,
    };
    const loaded = await loadAgentSourceRecords({
      supabase: {} as SupabaseClient,
      agent,
      userId: "user-1",
      organizationId: "org-1",
    });
    assert.equal(loaded.empty, true);
    assert.equal(loaded.retrievedCount, 0);
  });

  it("treats a saved Google Sheets source as unavailable without crashing", async () => {
    const agent = sampleAgent();
    agent.safetySettings.dataSource = {
      kind: "google_sheets",
      verifiedAt: "2026-01-01T00:00:00.000Z",
      lastError: null,
      isSample: false,
      mapping: [{ sourceColumn: "ticket_id", targetField: "ticket_id" }],
      headers: ["ticket_id"],
      rowCount: 10,
      sheets: {
        spreadsheetId: "legacy-sheet",
        range: "Sheet1!A1:Z200",
        access: "public",
      },
    };
    const loaded = await loadAgentSourceRecords({
      supabase: {} as SupabaseClient,
      agent,
      userId: "user-1",
      organizationId: "org-1",
    });
    assert.equal(loaded.unavailable, true);
    assert.equal(loaded.retrievedCount, 0);
    assert.match(loaded.error ?? "", /no longer supported/i);
  });
});
