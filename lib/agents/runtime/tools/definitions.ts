import { getToolDefinition, resolveToolName } from "../../tools/catalog";

/** Maps gateway tool names to policy action types. */
export const TOOL_ACTION_TYPES: Record<string, string> = {
  web_search: "research.web_search",
  http_request: "integration.http",
  fetch_url: "research.fetch_url",
  send_email: "communication.email",
  send_whatsapp_message: "communication.whatsapp",
  issue_refund: "financial.refund",
  update_crm_record: "crm.update",
  delete_crm_record: "crm.delete",
  query_database: "data.query",
  query_supabase: "data.query",
  read_document: "data.document_read",
  google_sheets: "integration.google_sheets",
  x_search: "social.x_search",
  create_calendar_event: "calendar.create",
  create_service_quote: "service.quote",
  verify_service_address: "service.address_verify",
  request_electrician_visit: "service.appointment_request",
  plan_travel_itinerary: "travel.itinerary",
  request_travel_booking: "travel.booking_request",
  plan_wedding_event: "wedding.plan",
  request_wedding_deposit: "wedding.deposit",
  plan_group_outing: "group.plan",
  request_group_reservation: "group.reservation",
};

export function resolveActionType(toolName: string, override?: string): string {
  if (override?.trim()) return override.trim();
  const resolved = resolveToolName(toolName);
  const tool = getToolDefinition(resolved);
  if (tool) return tool.actionType;
  return TOOL_ACTION_TYPES[resolved] ?? resolved.replace(/_/g, ".");
}

export function toolDescription(toolName: string): string {
  const resolved = resolveToolName(toolName);
  const tool = getToolDefinition(resolved);
  if (tool) return tool.description;

  const descriptions: Record<string, string> = {
    send_email: "Send an email message",
    send_whatsapp_message: "Send a WhatsApp message",
    issue_refund: "Issue a customer refund",
    update_crm_record: "Update a CRM customer record",
    delete_crm_record: "Delete a CRM customer record",
    query_database: "Query a database (read-only when configured)",
    create_calendar_event: "Create a calendar event",
  };
  return descriptions[resolved] ?? resolved.replace(/_/g, " ");
}
