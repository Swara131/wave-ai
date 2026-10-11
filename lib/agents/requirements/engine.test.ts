import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAgentRequirements, getMissingRequirements } from "./engine";
import type { AgentRequirementSnapshot } from "./types";

function snapshot(partial: Partial<AgentRequirementSnapshot> & { goal: string }): AgentRequirementSnapshot {
  return {
    agentId: partial.agentId ?? "agent",
    name: partial.name ?? "Test Agent",
    kind: partial.kind ?? "builder",
    description: partial.goal,
    instructions: partial.goal,
    tools: partial.tools ?? [],
    triggerType: partial.triggerType ?? "webhook",
    schedule: partial.schedule ?? { when: "manual" },
    timezone: partial.timezone ?? "UTC",
    deliveryMode: partial.deliveryMode ?? "notification",
    ...partial,
  };
}

function keys(snapshotInput: AgentRequirementSnapshot): string[] {
  return getAgentRequirements(snapshotInput)
    .requirements.filter((item) => item.required)
    .map((item) => item.key);
}

describe("getAgentRequirements", () => {
  it("Agent A: research only — no email, WhatsApp, CRM, or schedule", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "AI News Agent",
        goal: "Find the latest AI news and summarize the top 5 stories.",
        tools: ["web_search"],
      })
    );
    const k = result.requirements.filter((item) => item.required).map((item) => item.key);
    assert.ok(k.includes("ai_model"));
    assert.ok(k.includes("web_search"));
    assert.ok(k.includes("output"));
    assert.ok(!k.includes("email"));
    assert.ok(!k.includes("whatsapp"));
    assert.ok(!k.includes("crm"));
    assert.ok(!k.includes("schedule"));
  });

  it("Agent B: morning email summary needs schedule, email, and recipient", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "Morning Brief",
        goal: "Find the latest AI news every morning and email me a short summary.",
        tools: ["web_search", "send_email"],
        triggerType: "webhook",
        destinationEmail: null,
      })
    );
    const k = result.requirements.filter((item) => item.required).map((item) => item.key);
    assert.ok(k.includes("schedule"));
    assert.ok(k.includes("email"));
    assert.ok(k.includes("web_search"));
    const email = result.requirements.find((item) => item.key === "email");
    assert.equal(email?.status, "missing");
    assert.match(email?.reason ?? "", /email/i);
  });

  it("Agent C: CRM updater does not ask for search or email", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "CRM Updater",
        goal: "Update customer records in my CRM when support tickets are resolved.",
        tools: ["update_crm_record"],
      })
    );
    const k = result.requirements.filter((item) => item.required).map((item) => item.key);
    assert.ok(k.includes("crm"));
    assert.ok(k.includes("crm_policy"));
    assert.ok(!k.includes("web_search"));
    assert.ok(!k.includes("email"));
    assert.ok(!k.includes("whatsapp"));
    assert.ok(!k.includes("schedule"));
  });

  it("Agent D: WhatsApp urgent tickets does not require CRM write", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "Urgent Ping",
        goal: "Send me a WhatsApp notification whenever a support ticket is marked urgent.",
        tools: ["send_whatsapp_message"],
        deliveryMode: "whatsapp",
        destinationPhone: null,
      })
    );
    const k = result.requirements.filter((item) => item.required).map((item) => item.key);
    assert.ok(k.includes("whatsapp"));
    assert.ok(!k.includes("crm"));
    assert.ok(!k.includes("email"));
  });

  it("Agent E: refund decision does not require email", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "Refund Decider",
        kind: "decision",
        goal: "Decide whether a customer's refund should be automatically approved.",
        tools: ["issue_refund"],
        decisionConfig: {
          decisionQuestion: "Approve this refund?",
          inputs: ["amount", "customer"],
          rules: [{ id: "r1", label: "Under 5k", expression: "amount < 5000", outcome: "allow" }],
          actions: ["approve"],
          approvalWhen: "amount >= 5000",
          workflow: [],
          aiReasoningEnabled: true,
        },
      })
    );
    const k = result.requirements.filter((item) => item.required).map((item) => item.key);
    assert.ok(k.includes("decision_rules"));
    assert.ok(k.includes("refund_input"));
    assert.ok(k.includes("safety"));
    assert.ok(!k.includes("email"));
    assert.ok(!k.includes("fraud_signals"));
  });

  it("fraud decision does not reuse refund requirements", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "Fraud Decider",
        kind: "decision",
        goal: "Decide whether this transaction is fraud.",
        decisionConfig: {
          decisionQuestion: "Is this fraud?",
          inputs: ["amount", "device"],
          rules: [{ id: "r1", label: "High risk", expression: "risk > 80", outcome: "block" }],
          actions: ["block"],
          approvalWhen: "risk > 50",
          workflow: [],
          aiReasoningEnabled: true,
        },
      })
    );
    const k = result.requirements.filter((item) => item.required).map((item) => item.key);
    assert.ok(k.includes("fraud_signals"));
    assert.ok(!k.includes("refund_input"));
    assert.ok(!k.includes("email"));
  });

  it("Agent F: weekly research asks for destination, not email", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "Competitor Watch",
        goal: "Research competitors every Monday and create a report.",
        tools: ["web_search"],
      })
    );
    const k = result.requirements.filter((item) => item.required).map((item) => item.key);
    assert.ok(k.includes("schedule"));
    assert.ok(k.includes("web_search"));
    assert.ok(k.includes("output_destination"));
    assert.ok(!k.includes("email"));
  });

  it("simple chatbot does not require CRM or schedule", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "Help Chat",
        goal: "Answer customer questions in the product using our help center.",
        tools: [],
      })
    );
    const k = result.requirements.filter((item) => item.required).map((item) => item.key);
    assert.ok(!k.includes("crm"));
    assert.ok(!k.includes("schedule"));
    assert.ok(!k.includes("email"));
  });

  it("external n8n agent asks for connection, not email", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "n8n Sync",
        kind: "external",
        goal: "Run my n8n workflow when Wave receives a webhook.",
        externalConnection: {
          origin: "external",
          platform: "n8n",
          connectionMethod: "webhook",
          agentName: "n8n Sync",
          agentSlug: "n8n-sync",
          endpointUrl: null,
          authConfigured: false,
          safetyEligible: false,
          updatedAt: new Date().toISOString(),
        },
      })
    );
    const k = result.requirements.filter((item) => item.required).map((item) => item.key);
    assert.ok(k.includes("external_connection"));
    assert.ok(k.includes("external_auth"));
    assert.ok(!k.includes("email"));
  });

  it("adding email to the workflow adds an email requirement", () => {
    const before = getAgentRequirements(
      snapshot({
        goal: "Find the latest AI news and summarize the top 5 stories.",
        tools: ["web_search"],
      })
    );
    const after = getAgentRequirements(
      snapshot({
        goal: "Find the latest AI news and summarize the top 5 stories.",
        tools: ["web_search", "send_email"],
        destinationEmail: "swara@example.com",
      })
    );
    assert.ok(!before.requirements.some((item) => item.key === "email"));
    assert.ok(after.requirements.some((item) => item.key === "email" && item.status === "ready"));
  });

  it("different agents produce different requirement sets", () => {
    const a = keys(
      snapshot({ goal: "Find the latest AI news and summarize the top 5 stories.", tools: ["web_search"] })
    );
    const b = keys(
      snapshot({
        goal: "Find the latest AI news every morning and email me a short summary.",
        tools: ["web_search", "send_email"],
      })
    );
    assert.notDeepEqual(a.sort(), b.sort());
  });

  it("getMissingRequirements lists only incomplete required items", () => {
    const missing = getMissingRequirements(
      snapshot({
        goal: "Find the latest AI news every morning and email me a short summary.",
        tools: ["web_search", "send_email"],
      })
    );
    assert.ok(missing.every((item) => item.required && item.status === "missing"));
    assert.ok(missing.some((item) => item.key === "email" || item.key === "schedule"));
    assert.ok(!missing.some((item) => item.key === "crm"));
  });

  it("treats a generated graph as a ready workflow even without a trigger category", () => {
    const result = getAgentRequirements(
      snapshot({
        goal: "Creates company, contact, and meeting briefs.",
        tools: ["web_search", "create_calendar_event"],
        workflow: {
          version: 1,
          nodes: [
            {
              id: "ai-1",
              type: "ai_reasoning",
              category: "ai",
              name: "Briefing agent",
              description: "Draft briefs",
              config: {},
              status: "valid",
              position: 0,
            },
          ],
          edges: [],
        },
      })
    );
    const workflow = result.requirements.find((item) => item.key === "workflow");
    assert.equal(workflow?.status, "ready");
  });

  it("sales briefing agent asks for company, contact, meeting, and delivery — not WhatsApp", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "Sales Call Briefing Agent",
        goal: "Prepare company, contact and meeting briefs before sales calls.",
        tools: ["web_search"],
        workflow: {
          version: 1,
          nodes: [
            {
              id: "ai-1",
              type: "ai_reasoning",
              category: "ai",
              name: "Briefing",
              description: "Draft briefs",
              config: {},
              status: "valid",
              position: 0,
            },
          ],
          edges: [],
        },
      })
    );
    const k = result.requirements.filter((item) => item.required).map((item) => item.key);
    assert.ok(k.includes("company_name"));
    assert.ok(k.includes("contact_name"));
    assert.ok(k.includes("contact_role"));
    assert.ok(k.includes("meeting_date"));
    assert.ok(k.includes("meeting_type"));
    assert.ok(k.includes("research"));
    assert.ok(k.includes("briefing_format"));
    assert.ok(k.includes("output_destination"));
    assert.ok(!k.includes("whatsapp"));
    assert.ok(!k.includes("email"));
    assert.ok(!k.includes("meeting_details"));
    const company = result.requirements.find((item) => item.key === "company_name");
    assert.equal(company?.status, "missing");
    assert.equal(result.jobProfile, "sales_briefing");
    assert.ok(result.sections.some((section) => section.id === "company"));
    assert.ok(result.sections.some((section) => section.id === "contact"));
    assert.ok(result.sections.some((section) => section.id === "meeting"));
  });

  it("news agent asks for topic and sources, not company or meeting", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "AI News Agent",
        goal: "Find the latest AI news and summarize it.",
        tools: ["web_search"],
      })
    );
    const k = result.requirements.map((item) => item.key);
    assert.ok(k.includes("research_topic"));
    assert.ok(k.includes("story_count"));
    assert.ok(k.includes("summary_length"));
    assert.ok(!k.includes("company_name"));
    assert.ok(!k.includes("contact_name"));
    assert.ok(!k.includes("meeting_date"));
    assert.equal(result.jobProfile, "news_digest");
  });

  it("CRM agent asks for customer and fields, not meeting or LinkedIn", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "CRM Agent",
        goal: "Update customer records when support tickets are resolved.",
        tools: ["update_crm_record"],
      })
    );
    const k = result.requirements.map((item) => item.key);
    assert.ok(k.includes("crm"));
    assert.ok(k.includes("customer_identifier"));
    assert.ok(k.includes("crm_fields"));
    assert.ok(k.includes("ticket_source"));
    assert.ok(!k.includes("meeting_date"));
    assert.ok(!k.includes("company_linkedin"));
    assert.equal(result.jobProfile, "crm_update");
    assert.equal(
      result.requirements.find((item) => item.key === "ticket_source")?.status,
      "missing"
    );
  });

  it("requires a verified data source for query/ticket analysis agents", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "Evidence Agent",
        goal: "Analyze support tickets and validate incident evidence.",
        tools: ["query_supabase"],
      })
    );
    const dataSource = result.requirements.find((item) => item.key === "data_source");
    assert.equal(dataSource?.required, true);
    assert.equal(dataSource?.status, "missing");
  });

  it("marks connected data source ready after a verified CSV", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "Evidence Agent",
        goal: "Analyze support tickets and validate incident evidence.",
        tools: ["query_supabase"],
        setupAnswers: { ticket_source: "csv_upload", data_source: "verified" },
        safetySettings: {
          dataSource: {
            kind: "csv_upload",
            verifiedAt: new Date().toISOString(),
            lastError: null,
            isSample: false,
            mapping: [{ sourceColumn: "ticket_id", targetField: "ticket_id" }],
            headers: ["ticket_id"],
            rowCount: 2,
            csv: {
              uploadId: "",
              filename: "tickets.csv",
              storagePath: "",
              inlineText: "ticket_id\nTKT-1",
            },
          },
        },
      })
    );
    assert.equal(result.requirements.find((item) => item.key === "data_source")?.status, "ready");
    assert.equal(result.requirements.find((item) => item.key === "ticket_source")?.status, "ready");
  });

  it("does not treat a saved Google Sheets source as ready", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "Evidence Agent",
        goal: "Analyze support tickets and validate incident evidence.",
        tools: ["query_supabase"],
        setupAnswers: { ticket_source: "google_sheets" },
        safetySettings: {
          dataSource: {
            kind: "google_sheets",
            verifiedAt: new Date().toISOString(),
            lastError: null,
            isSample: false,
            mapping: [],
            headers: [],
            rowCount: 3,
            sheets: {
              spreadsheetId: "legacy-sheet",
              range: "Sheet1!A1:Z200",
              access: "public",
            },
          },
        },
      })
    );
    assert.equal(result.requirements.find((item) => item.key === "ticket_source")?.status, "missing");
    assert.equal(result.requirements.find((item) => item.key === "data_source")?.status, "missing");
    assert.ok(
      !(result.requirements.find((item) => item.key === "ticket_source")?.options ?? []).some(
        (option) => option.id === "google_sheets"
      )
    );
  });

  it("marks ticket source ready after a live builder answer", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "CRM Agent",
        goal: "Update customer records when support tickets are resolved.",
        tools: ["update_crm_record"],
        setupAnswers: { ticket_source: "manual" },
      })
    );
    assert.equal(
      result.requirements.find((item) => item.key === "ticket_source")?.status,
      "ready"
    );
  });

  it("WhatsApp ticket agent asks for trigger and recipient, not sales briefing fields", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "WhatsApp Agent",
        goal: "Send me a WhatsApp message when a ticket becomes urgent.",
        tools: ["send_whatsapp_message"],
        deliveryMode: "whatsapp",
      })
    );
    const k = result.requirements.map((item) => item.key);
    assert.ok(k.includes("whatsapp"));
    assert.ok(k.includes("urgency_condition"));
    assert.ok(k.includes("message_format"));
    assert.ok(k.includes("ticket_source"));
    assert.ok(!k.includes("company_name"));
    assert.ok(!k.includes("meeting_type"));
    assert.equal(result.jobProfile, "whatsapp_notify");
  });

  it("refund agent asks for customer, amount, policy, and safety — not meeting fields", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "Refund Decision Agent",
        kind: "decision",
        goal: "Decide whether a customer's refund should be automatically approved.",
        tools: ["issue_refund"],
        decisionConfig: {
          decisionQuestion: "Approve this refund?",
          inputs: ["amount", "customer"],
          rules: [{ id: "r1", label: "Under 5k", expression: "amount < 5000", outcome: "allow" }],
          actions: ["approve"],
          approvalWhen: "amount >= 5000",
          workflow: [],
          aiReasoningEnabled: true,
        },
      })
    );
    const k = result.requirements.map((item) => item.key);
    assert.ok(k.includes("refund_customer"));
    assert.ok(k.includes("refund_amount"));
    assert.ok(k.includes("decision_rules"));
    assert.ok(k.includes("safety"));
    assert.ok(!k.includes("meeting_date"));
    assert.ok(!k.includes("company_website"));
  });

  it("simple chatbot does not show sales, CRM, or schedule questions", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "Help Chat",
        goal: "Answer customer questions in the product using our help center.",
        tools: [],
      })
    );
    const k = result.requirements.map((item) => item.key);
    assert.ok(!k.includes("company_name"));
    assert.ok(!k.includes("crm"));
    assert.ok(!k.includes("schedule"));
    assert.ok(!k.includes("whatsapp"));
    assert.equal(result.jobProfile, "chatbot");
  });

  it("research=no hides research depth and does not keep it required", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "Sales Call Briefing Agent",
        goal: "Prepare company, contact, and meeting briefs before sales calls.",
        tools: ["web_search"],
        setupAnswers: { research: "no" },
      })
    );
    const k = result.requirements.map((item) => item.key);
    assert.ok(!k.includes("research_depth"));
    assert.ok(!k.includes("research_news"));
    assert.ok(k.includes("company_name"));
  });

  it("delivery=email adds a recipient; delivery=Wave does not", () => {
    const email = getAgentRequirements(
      snapshot({
        goal: "Prepare company, contact, and meeting briefs before sales calls.",
        tools: ["web_search"],
        setupAnswers: { output_destination: "email" },
        requirementChoices: { output: "email" },
      })
    );
    const wave = getAgentRequirements(
      snapshot({
        goal: "Prepare company, contact, and meeting briefs before sales calls.",
        tools: ["web_search"],
        setupAnswers: { output_destination: "notification" },
        requirementChoices: { output: "notification" },
      })
    );
    assert.ok(email.requirements.some((item) => item.key === "email"));
    assert.ok(!wave.requirements.some((item) => item.key === "email"));
    assert.ok(!wave.requirements.some((item) => item.key === "output_destination"));
  });

  it("CRM as a data source adds a CRM connection; manual does not", () => {
    const crm = getAgentRequirements(
      snapshot({
        goal: "Prepare company, contact, and meeting briefs before sales calls.",
        tools: ["web_search"],
        setupAnswers: { company_source: "crm" },
      })
    );
    const manual = getAgentRequirements(
      snapshot({
        goal: "Prepare company, contact, and meeting briefs before sales calls.",
        tools: ["web_search"],
        setupAnswers: { company_source: "manual" },
      })
    );
    assert.ok(crm.requirements.some((item) => item.key === "crm"));
    assert.ok(!manual.requirements.some((item) => item.key === "crm"));
  });

  it("progress counts required business inputs, not auto-ready model items", () => {
    const result = getAgentRequirements(
      snapshot({
        name: "Sales Call Briefing Agent",
        goal: "Prepare company, contact, and meeting briefs before sales calls.",
        tools: ["web_search"],
        workflow: {
          version: 1,
          nodes: [
            {
              id: "ai-1",
              type: "ai_reasoning",
              category: "ai",
              name: "Input company",
              description: "Input contact. Input meeting details. Web research. Prepare briefing. Deliver briefing.",
              config: {},
              status: "valid",
              position: 0,
            },
          ],
          edges: [],
        },
        setupAnswers: {
          company_name: "Acme Technologies",
          contact_name: "Jane Smith",
          contact_role: "VP of Sales",
          meeting_date: "2026-10-10",
          meeting_type: "discovery",
          output_destination: "notification",
        },
        requirementChoices: { output: "notification" },
      })
    );
    assert.ok(result.requiredCount > 0);
    assert.ok(result.readyCount <= result.requiredCount);
    assert.ok(result.testScenario.some((line) => line.value.includes("Acme")));
    assert.ok(result.testScenario.some((line) => line.value.includes("Jane")));
    assert.equal(result.requirements.find((item) => item.key === "ai_model")?.countsTowardProgress, false);
  });

  it("answering delivery adds email and removes the destination question", () => {
    const after = getAgentRequirements(
      snapshot({
        goal: "Research competitors every Monday and create a report.",
        tools: ["web_search"],
        setupAnswers: { output_destination: "email", schedule: JSON.stringify({ when: "weekly", time: "10:00", timezone: "UTC" }) },
        requirementChoices: { output: "email" },
        destinationEmail: "swara@example.com",
        triggerType: "schedule",
        schedule: { when: "weekly", time: "10:00" },
      })
    );
    const k = after.requirements.filter((item) => item.required).map((item) => item.key);
    assert.ok(k.includes("email"));
    assert.ok(!k.includes("output_destination"));
  });
});
