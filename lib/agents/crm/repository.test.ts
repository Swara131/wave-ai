import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CRM_TABLE_MISSING_MESSAGE,
  isMissingCrmTableError,
  listCrmRecords,
} from "./repository";
import { sanitizeDatabaseError } from "./db-errors";

function mockClient(result: {
  data: Record<string, unknown>[] | null;
  error: { message: string; code?: string } | null;
}): SupabaseClient {
  const chain = {
    select() {
      return chain;
    },
    eq() {
      return chain;
    },
    limit() {
      return chain;
    },
    then(
      resolve: (value: typeof result) => unknown,
      reject: (reason: unknown) => unknown
    ) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return {
    from() {
      return chain;
    },
  } as unknown as SupabaseClient;
}

describe("CRM table diagnostics", () => {
  it("detects a missing agent_crm_updates schema-cache error", () => {
    assert.equal(
      isMissingCrmTableError(
        "Could not find the table 'public.agent_crm_updates' in the schema cache"
      ),
      true
    );
  });

  it("ignores unrelated query errors", () => {
    assert.equal(isMissingCrmTableError("duplicate key value"), false);
    assert.equal(isMissingCrmTableError("connection refused"), false);
  });

  it("redacts credentials from database errors", () => {
    const sanitized = sanitizeDatabaseError(
      "Failed postgresql://postgres.abc:hunter2@db.supabase.co/postgres eyJhbGciOiJIUzI1NiJ9.aaa.bbb"
    );
    assert.doesNotMatch(sanitized, /hunter2/);
    assert.doesNotMatch(sanitized, /eyJhbGciOiJIUzI1NiJ9/);
  });

  it("reports a missing table instead of treating it as empty", async () => {
    const listed = await listCrmRecords(
      mockClient({
        data: null,
        error: {
          message: "Could not find the table 'public.agent_crm_updates' in the schema cache",
          code: "PGRST205",
        },
      }),
      {
        organizationId: "org-1",
        userId: "user-1",
        agentId: "agent-1",
        limit: 10,
      }
    );
    assert.equal(listed.tableAvailable, false);
    assert.equal(listed.rows.length, 0);
    assert.equal(listed.error, CRM_TABLE_MISSING_MESSAGE);
  });

  it("keeps connection failures distinct from a missing table", async () => {
    const listed = await listCrmRecords(
      mockClient({
        data: null,
        error: { message: "connection refused", code: "PGRST000" },
      }),
      {
        organizationId: "org-1",
        userId: "user-1",
        agentId: "agent-1",
        limit: 10,
      }
    );
    assert.equal(listed.tableAvailable, true);
    assert.match(listed.error ?? "", /connection refused/);
  });

  it("returns real empty rows when the table exists", async () => {
    const listed = await listCrmRecords(
      mockClient({ data: [], error: null }),
      {
        organizationId: "org-1",
        userId: "user-1",
        agentId: "agent-1",
        limit: 10,
      }
    );
    assert.equal(listed.tableAvailable, true);
    assert.equal(listed.error, null);
    assert.equal(listed.rows.length, 0);
  });
});
