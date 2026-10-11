import { handleSendEmail } from "../runtime/tools/handlers/send-email";
import type { ZeltaToolDefinition } from "./types";
import { handleGoogleSheets } from "./handlers/google-sheets";
import { handleHttpRequest } from "./handlers/http-request";
import { handleQuerySupabase } from "./handlers/query-supabase";
import { handleReadDocument } from "./handlers/read-document";
import { handleSendWhatsAppMessage } from "./handlers/send-whatsapp-message";
import { handleUpdateCrmRecord } from "./handlers/update-crm-record";
import { handleDeleteCrmRecord } from "./handlers/delete-crm-record";
import { handleUnconfiguredTool } from "./handlers/unconfigured";
import { handleWebSearch } from "./handlers/web-search";
import { handleXApi } from "./handlers/x-api";

const OBJECT_OUTPUT: ZeltaToolDefinition["outputSchema"] = {
  type: "object",
  properties: {
    executed: { type: "boolean" },
    data: { type: "object" },
  },
};

export const ZELTA_TOOL_CATALOG: ZeltaToolDefinition[] = [
  {
    name: "web_search",
    label: "Web search",
    description: "Search the public web for recent information.",
    actionType: "research.web_search",
    riskLevel: "low",
    permissions: [
      {
        provider: "web_search",
        label: "Web search",
        description: "Requires TAVILY_API_KEY or BRAVE_SEARCH_API_KEY.",
        envVarsAny: ["TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY"],
        settingsPath: "/settings?tab=integrations&provider=web_search",
      },
    ],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        count: { type: "number", description: "Max results (1-10)" },
      },
      required: ["query"],
    },
    outputSchema: OBJECT_OUTPUT,
    handler: handleWebSearch,
  },
  {
    name: "http_request",
    label: "HTTP request",
    description: "Make an outbound HTTP request to a public URL.",
    actionType: "integration.http",
    riskLevel: "medium",
    permissions: [{ provider: "none", label: "Built-in", description: "No credentials required." }],
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Target URL (http/https)" },
        method: { type: "string", description: "GET, POST, PUT, PATCH, DELETE, HEAD" },
        headers: { type: "object", description: "Optional request headers" },
        body: { type: "object", description: "JSON body for POST/PUT/PATCH" },
      },
      required: ["url"],
    },
    outputSchema: OBJECT_OUTPUT,
    handler: handleHttpRequest,
  },
  {
    name: "send_email",
    label: "Send email",
    description: "Send an email message through Resend.",
    actionType: "communication.email",
    riskLevel: "medium",
    permissions: [
      {
        provider: "resend",
        label: "Email (Resend)",
        description: "Requires RESEND_API_KEY and RESEND_FROM_EMAIL.",
        envVars: ["RESEND_API_KEY", "RESEND_FROM_EMAIL"],
        settingsPath: "/settings?tab=integrations&provider=email",
      },
    ],
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email" },
        subject: { type: "string", description: "Email subject" },
        message: { type: "string", description: "Plain-text body" },
      },
      required: ["to", "subject", "message"],
    },
    outputSchema: OBJECT_OUTPUT,
    handler: handleSendEmail,
  },
  {
    name: "google_sheets",
    label: "Google Sheets",
    description: "No longer available. Use a CSV upload or sample rows as the agent data source.",
    actionType: "integration.google_sheets",
    riskLevel: "low",
    permissions: [],
    inputSchema: {
      type: "object",
      properties: {
        spreadsheetId: { type: "string", description: "Spreadsheet ID from the URL" },
        range: { type: "string", description: "A1 notation range, e.g. Sheet1!A1:Z100" },
      },
      required: ["spreadsheetId"],
    },
    outputSchema: OBJECT_OUTPUT,
    handler: handleGoogleSheets,
  },
  {
    name: "x_search",
    label: "X search",
    description: "Search recent posts on X.",
    actionType: "social.x_search",
    riskLevel: "low",
    permissions: [
      {
        provider: "x_api",
        label: "X API",
        description: "Requires X_API_BEARER_TOKEN.",
        envVars: ["X_API_BEARER_TOKEN"],
        settingsPath: "/settings?tab=integrations&provider=x",
      },
    ],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        maxResults: { type: "number", description: "Max tweets (1-10)" },
      },
      required: ["query"],
    },
    outputSchema: OBJECT_OUTPUT,
    handler: handleXApi,
  },
  {
    name: "query_supabase",
    label: "Database query",
    description: "Read rows from your Wave data (tickets/CRM, uploads, proposals, or agents).",
    actionType: "data.query",
    riskLevel: "low",
    permissions: [{ provider: "none", label: "Built-in", description: "Uses your Wave workspace data." }],
    inputSchema: {
      type: "object",
      properties: {
        table: {
          type: "string",
          description: "agent_crm_updates | uploaded_logs | action_proposals | agents",
        },
        limit: { type: "number", description: "Max rows (1-25)" },
        slug: { type: "string", description: "Filter agents by slug" },
        status: { type: "string", description: "Filter uploaded_logs by status" },
      },
    },
    outputSchema: OBJECT_OUTPUT,
    handler: handleQuerySupabase,
  },
  {
    name: "read_document",
    label: "Read document",
    description: "Read a file you uploaded to Wave.",
    actionType: "data.document_read",
    riskLevel: "low",
    permissions: [{ provider: "none", label: "Built-in", description: "Uses Supabase storage log-uploads bucket." }],
    inputSchema: {
      type: "object",
      properties: {
        uploadId: { type: "string", description: "Uploaded log/document ID" },
        storagePath: { type: "string", description: "Storage path under your user folder" },
      },
    },
    outputSchema: OBJECT_OUTPUT,
    handler: handleReadDocument,
  },
  {
    name: "send_whatsapp_message",
    label: "WhatsApp",
    description: "Send a WhatsApp message.",
    actionType: "communication.whatsapp",
    riskLevel: "medium",
    permissions: [
      {
        provider: "twilio",
        label: "WhatsApp (Twilio)",
        description: "Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_FROM.",
        envVars: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM"],
        settingsPath: "/settings?tab=integrations&provider=whatsapp",
      },
    ],
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        message: { type: "string" },
      },
      required: ["to", "message"],
    },
    outputSchema: OBJECT_OUTPUT,
    handler: handleSendWhatsAppMessage,
  },
  {
    name: "issue_refund",
    label: "Issue refund",
    description: "Issue a customer refund.",
    actionType: "financial.refund",
    riskLevel: "critical",
    permissions: [
      {
        provider: "none",
        label: "Payments",
        description: "Refund connector is not available yet.",
        settingsPath: "/settings?tab=integrations&provider=payments",
      },
    ],
    inputSchema: {
      type: "object",
      properties: {
        customerId: { type: "string" },
        amount: { type: "number" },
        currency: { type: "string" },
      },
      required: ["customerId", "amount"],
    },
    outputSchema: OBJECT_OUTPUT,
    handler: (input) => handleUnconfiguredTool("issue_refund", input),
  },
  {
    name: "update_crm_record",
    label: "Update CRM",
    description: "Update a CRM customer record.",
    actionType: "crm.update",
    riskLevel: "high",
    permissions: [
      {
        provider: "zelta",
        label: "Wave CRM",
        description: "Stores support-ticket resolutions in your workspace.",
        settingsPath: "/agents",
      },
    ],
    inputSchema: {
      type: "object",
      properties: {
        ticketId: { type: "string" },
        customerId: { type: "string" },
        customerName: { type: "string" },
        resolutionDetails: { type: "string" },
        satisfactionRating: { type: "number" },
      },
      required: ["ticketId", "customerId", "resolutionDetails"],
    },
    outputSchema: OBJECT_OUTPUT,
    handler: handleUpdateCrmRecord,
  },
  {
    name: "delete_crm_record",
    label: "Delete CRM record",
    description: "Permanently delete a CRM customer record.",
    actionType: "crm.delete",
    riskLevel: "high",
    permissions: [
      {
        provider: "zelta",
        label: "Wave CRM",
        description: "Deletes support-ticket / customer records in your workspace.",
        settingsPath: "/agents",
      },
    ],
    inputSchema: {
      type: "object",
      properties: {
        customerId: { type: "string", description: "Customer ID to delete" },
      },
      required: ["customerId"],
    },
    outputSchema: OBJECT_OUTPUT,
    handler: handleDeleteCrmRecord,
  },
  {
    name: "create_calendar_event",
    label: "Calendar event",
    description: "Create a calendar event.",
    actionType: "calendar.create",
    riskLevel: "medium",
    permissions: [
      {
        provider: "none",
        label: "Calendar",
        description: "Calendar connector is not available yet.",
        settingsPath: "/settings?tab=integrations&provider=calendar",
      },
    ],
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        startsAt: { type: "string" },
      },
      required: ["title", "startsAt"],
    },
    outputSchema: OBJECT_OUTPUT,
    handler: (input) => handleUnconfiguredTool("create_calendar_event", input),
  },
];

/** Legacy tool names stored on older agents. */
export const TOOL_NAME_ALIASES: Record<string, string> = {
  query_database: "query_supabase",
  x_read: "x_search",
  x_post: "x_search",
  delete_record: "delete_crm_record",
  delete_customer: "delete_crm_record",
};

const CATALOG_BY_NAME = new Map(
  ZELTA_TOOL_CATALOG.map((tool) => [tool.name, tool])
);

export function resolveToolName(name: string): string {
  const normalized = name.trim().toLowerCase();
  return TOOL_NAME_ALIASES[normalized] ?? normalized;
}

export function getToolDefinition(name: string): ZeltaToolDefinition | undefined {
  return CATALOG_BY_NAME.get(resolveToolName(name));
}

export function listToolDefinitions(): ZeltaToolDefinition[] {
  return ZELTA_TOOL_CATALOG;
}
