import { HIGH_IMPACT_WORKFLOW_TOOLS } from "@/lib/agents/workflow/types";
import { extractWorkflowSignals } from "./from-workflow";
import { extractIntentSignals } from "./intent-signals";
import {
  businessFieldsForJob,
  extractWorkflowJobHints,
  fieldIsVisible,
  inferJobProfile,
} from "./business-inputs";
import { isDataSourceVerified } from "@/lib/agents/data-source/config";
import {
  asSetupAnswers,
  type AgentReadiness,
  type AgentRequirement,
  type AgentRequirementSnapshot,
  type AgentRequirementsResult,
  type RequirementSection,
  type RequirementStage,
  type TestScenarioLine,
} from "./types";

function textBlob(snapshot: AgentRequirementSnapshot): string {
  return [snapshot.goal, snapshot.description, snapshot.instructions].filter(Boolean).join("\n");
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function ready(status: boolean): "ready" | "missing" {
  return status ? "ready" : "missing";
}

function hasHighImpact(tools: string[]): boolean {
  return tools.some((tool) =>
    HIGH_IMPACT_WORKFLOW_TOOLS.includes(tool as (typeof HIGH_IMPACT_WORKFLOW_TOOLS)[number])
  );
}

function applyJobDefaults(
  profile: ReturnType<typeof inferJobProfile>,
  answers: Record<string, string>,
  tools: string[],
  timezone: string | null | undefined
): Record<string, string> {
  const next = { ...answers };
  if (profile === "sales_briefing") {
    if (!next.company_source) next.company_source = "manual";
    if (!next.contact_source) next.contact_source = "manual";
    if (!next.research && tools.includes("web_search")) next.research = "yes";
    if (!next.briefing_length) next.briefing_length = "standard";
    if (!next.briefing_format) next.briefing_format = "structured";
    if (!next.briefing_contents) {
      next.briefing_contents =
        "company_overview,contact_overview,recent_news,objectives,talking_points,questions";
    }
    if (!next.meeting_timezone) next.meeting_timezone = timezone || "Asia/Kolkata";
  }
  if (profile === "news_digest") {
    if (!next.story_count) next.story_count = "5";
    if (!next.summary_length) next.summary_length = "standard";
  }
  if (profile === "sales_briefing") {
    if (!next.research_depth && next.research === "yes") next.research_depth = "standard";
    if (!next.research_company && next.research === "yes") next.research_company = "yes";
    if (!next.research_contact && next.research === "yes") next.research_contact = "yes";
    if (!next.contact_company && next.company_name) next.contact_company = next.company_name;
  }
  return next;
}

function answersOf(snapshot: AgentRequirementSnapshot): Record<string, string> {
  return {
    ...asSetupAnswers(snapshot.requirementChoices),
    ...asSetupAnswers(snapshot.setupAnswers),
  };
}

function ans(answers: Record<string, string>, key: string): string {
  return (answers[key] ?? "").trim();
}

function decisionFlavor(text: string): "refund" | "fraud" | "generic" {
  if (/\brefund\b/i.test(text)) return "refund";
  if (/\bfraud\b/i.test(text)) return "fraud";
  return "generic";
}

export function getRequiredCapabilities(snapshot: AgentRequirementSnapshot): string[] {
  return getAgentRequirements(snapshot).requirements.filter((item) => item.required).map((item) => item.key);
}

export function getMissingRequirements(
  snapshot: AgentRequirementSnapshot
): AgentRequirement[] {
  return getAgentRequirements(snapshot).missing;
}

export function getAgentReadiness(snapshot: AgentRequirementSnapshot): AgentReadiness {
  const result = getAgentRequirements(snapshot);
  return {
    ready: result.ready,
    missing: result.missing,
    requiredCount: result.requiredCount,
    readyCount: result.readyCount,
  };
}

export function runAgentReadinessCheck(snapshot: AgentRequirementSnapshot): AgentReadiness {
  return getAgentReadiness(snapshot);
}

export function getAgentRequirements(snapshot: AgentRequirementSnapshot): AgentRequirementsResult {
  const stage: RequirementStage = snapshot.stage ?? "setup";
  const intent = extractIntentSignals(textBlob(snapshot));
  const workflow = extractWorkflowSignals(snapshot.workflow);
  const jobHints = extractWorkflowJobHints(snapshot.workflow);
  const jobProfile = inferJobProfile(textBlob(snapshot), jobHints);
  const tools = unique([...(snapshot.tools ?? []), ...workflow.tools]);
  const delivery = snapshot.deliveryMode ?? "notification";
  const rawAnswers = answersOf(snapshot);
  const answers = applyJobDefaults(jobProfile, rawAnswers, tools, snapshot.timezone);
  const choices = snapshot.requirementChoices ?? answers;

  const needsEmail =
    tools.includes("send_email") ||
    workflow.hasEmailOutput ||
    intent.wantsEmail ||
    delivery === "email" ||
    delivery === "both" ||
    choices.output === "email";

  const needsWhatsApp =
    tools.includes("send_whatsapp_message") ||
    intent.wantsWhatsApp ||
    delivery === "whatsapp" ||
    delivery === "both" ||
    choices.output === "whatsapp";

  const needsSlack = intent.wantsSlack || choices.output === "slack";

  const needsCrm = tools.includes("update_crm_record") || workflow.hasCrm || intent.wantsCrm;
  const researchChoice = ans(answers, "research");
  const needsSearch =
    researchChoice !== "no" &&
    (tools.includes("web_search") ||
      tools.includes("x_search") ||
      intent.wantsWebSearch ||
      researchChoice === "yes");
  const needsSchedule =
    snapshot.triggerType === "schedule" ||
    workflow.scheduledTrigger ||
    snapshot.schedule?.when === "daily" ||
    snapshot.schedule?.when === "weekly" ||
    snapshot.schedule?.when === "at_time" ||
    intent.wantsSchedule;

  const needsDecision =
    snapshot.kind === "decision" ||
    workflow.hasDecision ||
    intent.wantsDecision ||
    tools.includes("issue_refund");

  const needsApproval =
    intent.wantsApproval ||
    hasHighImpact(tools) ||
    (needsDecision && /\brefund|payment|delete\b/i.test(textBlob(snapshot)));

  const outputChosen =
    needsEmail ||
    needsWhatsApp ||
    needsSlack ||
    choices.output === "notification" ||
    choices.output === "other" ||
    delivery === "notification" && intent.outputChannelSpecified;

  const needsOutputClarification =
    snapshot.kind === "builder" &&
    intent.wantsOutput &&
    !intent.outputChannelSpecified &&
    !tools.includes("send_email") &&
    !tools.includes("send_whatsapp_message") &&
    !workflow.hasEmailOutput &&
    delivery !== "email" &&
    delivery !== "whatsapp" &&
    delivery !== "both" &&
    !choices.output &&
    !ans(answers, "output_destination");

  const needsCustomerSource = /\bpersonalized emails? to my customers\b/i.test(textBlob(snapshot));

  const requirements: AgentRequirement[] = [];

  const push = (item: Omit<AgentRequirement, "inputType"> & { inputType?: AgentRequirement["inputType"] }) => {
    const inputType = item.inputType ?? item.configurationType;
    if (item.dependsOn && ans(answers, item.dependsOn.key) !== item.dependsOn.equals) {
      return;
    }
    requirements.push({
      ...item,
      inputType,
      configurationType: inputType,
      options: item.options,
      kind: item.kind ?? "capability",
      countsTowardProgress: item.countsTowardProgress,
    });
  };

  if (snapshot.kind === "external" && snapshot.externalConnection) {
    const ext = snapshot.externalConnection;
    push({
      key: "external_connection",
      category: "external",
      label: `${ext.platform} connection`,
      description: "Endpoint Wave should call.",
      required: true,
      status: ready(Boolean(ext.endpointUrl) || Boolean(ans(answers, "external_connection"))),
      reason: "This agent runs outside Wave, so a connection is required.",
      configurationType: "url",
      value: ext.endpointUrl || ans(answers, "external_connection") || null,
      placeholder: "https://",
      validation: "url",
    });
    push({
      key: "external_auth",
      category: "external",
      label: "Authentication",
      description: "Confirm how Wave should authenticate to the external agent.",
      required: true,
      status: ready(ext.authConfigured || ext.authType === "none" || Boolean(ans(answers, "external_auth"))),
      reason: "Wave needs a safe way to call the external endpoint.",
      configurationType: "choice",
      value: ans(answers, "external_auth") || ext.authType || null,
      options: [
        { id: "none", label: "No auth" },
        { id: "bearer", label: "Bearer token (already configured)" },
        { id: "api_key_header", label: "API key header (already configured)" },
      ],
    });
    push({
      key: "external_safety",
      category: "safety",
      label: "Safety for external actions",
      description: "Apply Wave policy to actions the external agent can take.",
      required: true,
      status: ready(Boolean(snapshot.protectionConfigured || ext.safetyEligible)),
      reason: "External agents can still take high-impact actions.",
      configurationType: "policy",
      action: "Configure safety",
      actionHref: `/agents/${encodeURIComponent(snapshot.agentId)}/safety`,
    });
    push({
      key: "external_input_schema",
      category: "external",
      label: "What information should Wave send?",
      description: "Tell us what information the agent should use.",
      required: true,
      status: ready(Boolean(ext.lastTestPassed || ext.endpointUrl)),
      reason: "Tell us what information the agent should use.",
      configurationType: "none",
    });
    push({
      key: "external_output_schema",
      category: "external",
      label: "Output schema",
      description: "What Wave should expect back from the external agent.",
      required: true,
      status: ready(Boolean(ext.lastTestPassed || ext.endpointUrl)),
      reason: "Wave needs a known output shape to verify and protect the result.",
      configurationType: "none",
    });
  } else {
    push({
      key: "ai_model",
      category: "model",
      label: "AI model",
      description: "Wave will use the configured model to reason and write.",
      required: true,
      status: "ready",
      reason: "Every Wave agent needs a model to understand the task.",
      configurationType: "none",
      countsTowardProgress: false,
      kind: "capability",
    });

    if (snapshot.kind !== "decision") {
      push({
        key: "workflow",
        category: "workflow",
        label: "Workflow",
        description: "An editable sequence of steps for this agent.",
        required: true,
        status: ready(workflow.hasWorkflow),
        reason: "Wave needs a workflow so it knows what to do after you describe the goal.",
        configurationType: workflow.hasWorkflow ? "none" : "connection",
        action: workflow.hasWorkflow ? undefined : "Create workflow",
        actionHref: `/agents/${encodeURIComponent(snapshot.agentId)}/workflow`,
        countsTowardProgress: !workflow.hasWorkflow,
        kind: "capability",
      });
    }

    if (needsSearch && jobProfile !== "sales_briefing") {
      const confirmed = researchChoice === "yes" || tools.includes("web_search") || tools.includes("x_search");
      const interactive = !confirmed;
      push({
        key: "web_search",
        category: "tool",
        label: "Web research",
        description: "Look up current information from the web.",
        required: true,
        status: ready(confirmed),
        reason: "Your agent needs access to current information from the web.",
        configurationType: interactive ? "choice" : "none",
        value: confirmed ? "yes" : researchChoice || null,
        options: interactive
          ? [
              { id: "yes", label: "Enable web research" },
              { id: "no", label: "No" },
            ]
          : undefined,
        countsTowardProgress: interactive,
        kind: "capability",
        action: interactive ? "Enable web research" : undefined,
      });
    }

    if (needsSchedule) {
      const scheduled =
        snapshot.triggerType === "schedule" ||
        snapshot.schedule?.when === "daily" ||
        snapshot.schedule?.when === "weekly" ||
        snapshot.schedule?.when === "at_time";
      const scheduleValue = ans(answers, "schedule") || (scheduled && snapshot.timezone ? `${snapshot.schedule?.when}|${snapshot.schedule?.time ?? "09:00"}|${snapshot.timezone}` : "");
      push({
        key: "schedule",
        category: "schedule",
        label: "Schedule",
        description: "When this agent should run.",
        required: true,
        status: ready(Boolean(scheduleValue) || (scheduled && Boolean(snapshot.timezone))),
        reason:
          intent.scheduleKind === "weekly"
            ? "You asked this agent to run on a weekly cadence."
            : "Your agent needs a schedule because you asked it to run on a repeating cadence.",
        configurationType: "schedule",
        value: scheduleValue || null,
        kind: "configuration",
        section: "schedule",
        sectionTitle: "Schedule",
        sectionDescription: "When this agent should run. Skip this if you only want to run it by hand.",
      });
    }

    if (needsEmail) {
      const recipient =
        snapshot.destinationEmail?.includes("@") ||
        ans(answers, "email").includes("@") ||
        ans(answers, "destinationEmail").includes("@");
      push({
        key: "email",
        category: "output",
        label: "Email recipient",
        description: "Where the agent should send the result.",
        required: true,
        status: ready(Boolean(recipient)),
        reason: intent.wantsEmail
          ? "Your agent says it should email the result."
          : "The workflow includes an email step.",
        configurationType: "email",
        value: snapshot.destinationEmail || ans(answers, "email") || null,
        placeholder: "you@example.com",
        validation: "email",
        kind: "configuration",
        section: "delivery",
        sectionTitle: "How should the result be delivered?",
        sectionDescription: "Only needed if this agent emails the result.",
      });
    }

    if (needsWhatsApp) {
      const phone = snapshot.destinationPhone || ans(answers, "whatsapp");
      push({
        key: "whatsapp",
        category: "output",
        label: "WhatsApp recipient",
        description: "Send a WhatsApp notification.",
        required: true,
        status: ready(Boolean(phone)),
        reason: "Your agent should send a WhatsApp notification.",
        configurationType: "phone",
        value: phone || null,
        placeholder: "+91…",
        validation: "phone",
        kind: "configuration",
        section: "delivery",
        sectionTitle: "How should the result be delivered?",
        sectionDescription: "Only needed if this agent sends WhatsApp messages.",
      });
    }

    if (needsSlack) {
      push({
        key: "slack",
        category: "output",
        label: "Slack",
        description: "Slack delivery is not available in Wave yet.",
        required: false,
        status: "unavailable",
        reason: "You asked for Slack. Wave will keep results in the app until Slack is connected.",
        configurationType: "none",
      });
    }

    if (needsCrm) {
      const crmAnswer = ans(answers, "crm") || (tools.includes("update_crm_record") ? "wave_crm" : "");
      push({
        key: "crm",
        category: "integration",
        label: "CRM",
        description: "Update customer records in your CRM.",
        required: true,
        status: ready(Boolean(crmAnswer)),
        reason: "Your agent needs CRM access to update customer records.",
        configurationType: "choice",
        value: crmAnswer || null,
        options: [
          { id: "wave_crm", label: "Use Wave CRM" },
          { id: "hubspot", label: "HubSpot" },
          { id: "salesforce", label: "Salesforce" },
        ],
      });
      const policyAnswer = ans(answers, "crm_policy") || ans(answers, "safety");
      push({
        key: "crm_policy",
        category: "safety",
        label: "CRM update policy",
        description: "Rules for when customer records may be changed.",
        required: true,
        status: ready(Boolean(snapshot.protectionConfigured) || Boolean(policyAnswer)),
        reason: "Changing customer records is a high-impact action.",
        configurationType: "policy",
        value: policyAnswer || null,
        options: [
          { id: "allow", label: "Allow automatically" },
          { id: "ask", label: "Ask me first" },
          { id: "block", label: "Always block" },
        ],
      });
    }

    if (/\btickets?\b/i.test(textBlob(snapshot))) {
      const ticketAnswerRaw =
        ans(answers, "ticket_source") || snapshot.safetySettings?.dataSource?.kind || "";
      const ticketAnswer = ticketAnswerRaw === "google_sheets" ? "" : ticketAnswerRaw;
      push({
        key: "ticket_source",
        category: "input",
        label: "Ticket information",
        description: "Where Wave should read ticket records. Webhook/helpdesk are not claimed connected until those integrations exist.",
        required: true,
        status: ready(Boolean(ticketAnswer)),
        reason: "This agent reacts to support tickets, so it needs a ticket or event source.",
        configurationType: "choice",
        value: ticketAnswer || null,
        options: [
          { id: "csv_upload", label: "CSV upload" },
          { id: "wave_database", label: "Wave ticket table" },
          { id: "manual_sample", label: "Sample / test rows (not live data)" },
          { id: "manual", label: "Sample / test rows (not live data)" },
        ],
        section: "input",
        sectionTitle: "Data source",
        sectionDescription: "Connect real records or labeled sample data. Wave will not invent tickets.",
      });
    }

    if (
      tools.includes("query_supabase") ||
      tools.includes("query_database") ||
      /\btickets?\b/i.test(textBlob(snapshot))
    ) {
      const needsRecords = tools.includes("query_supabase") || tools.includes("query_database");
      const verified =
        isDataSourceVerified(snapshot.safetySettings?.dataSource ?? null) ||
        ans(answers, "data_source") === "verified";
      push({
        key: "data_source",
        category: "input",
        label: "Connected data source",
        description: "Verify CSV, sample rows, or the Wave ticket table before running.",
        required: needsRecords,
        status: needsRecords ? ready(verified) : verified ? "ready" : "optional",
        reason: "This agent needs records from a source you control. It will not insert fake tickets.",
        configurationType: "connection",
        value: snapshot.safetySettings?.dataSource?.kind ?? null,
        actionHref: snapshot.agentId ? `/agents/${encodeURIComponent(snapshot.agentId)}/prepare` : undefined,
        action: "Configure data source",
        section: "input",
        sectionTitle: "Data source",
      });
    }

    if (intent.wantsFiles) {
      const fileAnswer = ans(answers, "file_input");
      push({
        key: "file_input",
        category: "input",
        label: "File input",
        description: "Describe the files this agent should read.",
        required: true,
        status: ready(Boolean(fileAnswer)),
        reason: "You asked this agent to work with files.",
        configurationType: "textarea",
        value: fileAnswer || null,
        placeholder: "e.g. Uploaded PDF, CSV of customers",
      });
    }

    if (intent.wantsApi) {
      const apiAnswer = ans(answers, "api_integration");
      push({
        key: "api_integration",
        category: "integration",
        label: "API connection",
        description: "The external service this agent should call.",
        required: true,
        status: ready(Boolean(apiAnswer) || Boolean(snapshot.externalConnection?.endpointUrl)),
        reason: "You asked this agent to call another service.",
        configurationType: "url",
        value: apiAnswer || snapshot.externalConnection?.endpointUrl || null,
        placeholder: "https://",
        validation: "url",
      });
    }

    if (intent.wantsDatabase || tools.includes("query_supabase") || tools.includes("query_database")) {
      push({
        key: "database",
        category: "integration",
        label: "Database",
        description: "Read or write structured data.",
        required: true,
        status: ready(tools.includes("query_supabase") || tools.includes("query_database")),
        reason: "Your agent needs to store or look up records.",
        configurationType: "connection",
      });
    }

    if (needsOutputClarification) {
      const outputAnswer = ans(answers, "output_destination") || choices.output || "";
      push({
        key: "output_destination",
        category: "output",
        label: "How should the result be delivered?",
        description: "Choose where this agent should send its result.",
        required: true,
        status: ready(Boolean(outputAnswer)),
        reason: "You asked for a report or brief, but not where it should go. Wave will not assume email.",
        configurationType: "choice",
        value: outputAnswer || null,
        options: [
          { id: "notification", label: "Show in Wave" },
          { id: "email", label: "Email" },
          { id: "whatsapp", label: "WhatsApp" },
          { id: "slack", label: "Slack" },
        ],
        kind: "configuration",
        section: "delivery",
        sectionTitle: "How should the result be delivered?",
        sectionDescription: "Choose a channel only if this agent should send the result somewhere.",
      });
    } else if (!needsEmail && !needsWhatsApp && !needsSlack) {
      push({
        key: "output",
        category: "output",
        label: "Result",
        description: "The agent will produce a result you can review in Wave.",
        required: true,
        status: "ready",
        reason: outputChosen
          ? "Delivery is configured for this agent."
          : "Results stay in Wave until you add another destination.",
        configurationType: "none",
        countsTowardProgress: false,
        kind: "configuration",
        section: "delivery",
        sectionTitle: "How should the result be delivered?",
        sectionDescription: "Results stay in Wave unless you choose another channel.",
      });
    }

    if (needsCustomerSource) {
      const source = ans(answers, "customer_source") || choices.customerSource || "";
      push({
        key: "customer_source",
        category: "input",
        label: "Customer data",
        description: "Where Wave should load the people this agent writes to.",
        required: true,
        status: ready(Boolean(source)),
        reason: "Personalized outreach needs a customer list.",
        configurationType: "choice",
        value: source || null,
        options: [
          { id: "crm", label: "CRM" },
          { id: "csv", label: "CSV" },
          { id: "database", label: "Database" },
          { id: "api", label: "API" },
        ],
        kind: "configuration",
      });
    }

    const businessSpecs = businessFieldsForJob(jobProfile);
    for (const spec of businessSpecs) {
      if (!fieldIsVisible(spec, answers)) continue;
      let value = ans(answers, spec.key);
      if (spec.key === "company_source" && !value) value = "manual";
      if (spec.key === "contact_source" && !value) value = "manual";
      if (spec.key === "research" && !value && tools.includes("web_search")) value = "yes";
      if (spec.key === "briefing_length" && !value) value = "standard";
      if (spec.key === "briefing_format" && !value) value = "structured";
      if (spec.key === "briefing_contents" && !value) {
        value = "company_overview,contact_overview,recent_news,objectives,talking_points,questions";
      }
      if (spec.key === "story_count" && !value) value = "5";
      if (spec.key === "summary_length" && !value) value = "standard";
      if (spec.key === "meeting_timezone" && !value) value = snapshot.timezone || "Asia/Kolkata";
      if (spec.key === "research_depth" && !value && ans(answers, "research") === "yes") value = "standard";
      if (spec.key === "research_company" && !value && ans(answers, "research") === "yes") value = "yes";
      if (spec.key === "research_contact" && !value && ans(answers, "research") === "yes") value = "yes";
      if (spec.key === "contact_company" && !value) value = ans(answers, "company_name");
      const sourceRequired =
        (spec.key === "company_website" && ans(answers, "company_source") === "website") ||
        (spec.key === "company_api_endpoint" && ans(answers, "company_source") === "api") ||
        (spec.key === "contact_api_endpoint" && ans(answers, "contact_source") === "api");
      const required = spec.required || sourceRequired;
      const autoConfigured = ["company_source", "contact_source", "briefing_contents", "briefing_length", "briefing_format", "story_count", "meeting_timezone", "summary_length", "research_depth", "research_company", "research_contact"].includes(spec.key);
      const filled = Boolean(value);
      push({
        key: spec.key,
        category: spec.section === "briefing" || spec.section === "research" ? "output" : "input",
        label: spec.label,
        description: spec.description,
        required,
        status: required ? ready(filled) : filled ? "ready" : "optional",
        reason: spec.reason,
        configurationType: spec.type,
        value: value || null,
        options: spec.options,
        placeholder: spec.placeholder,
        validation: spec.validation,
        kind: spec.kind ?? "business",
        section: spec.section,
        sectionTitle: spec.sectionTitle,
        sectionDescription: spec.sectionDescription,
        dependsOn: spec.dependsOn,
        countsTowardProgress: required && !autoConfigured,
      });
    }

    const wantsCrmSource =
      ans(answers, "company_source") === "crm" || ans(answers, "contact_source") === "crm";
    if (wantsCrmSource && !needsCrm) {
      push({
        key: "crm",
        category: "integration",
        label: "CRM connection",
        description: "Connect CRM to load company or contact records.",
        required: true,
        status: ready(Boolean(ans(answers, "crm"))),
        reason: "You chose CRM as a data source.",
        configurationType: "choice",
        options: [
          { id: "wave_crm", label: "Use Wave CRM" },
          { id: "hubspot", label: "HubSpot" },
          { id: "salesforce", label: "Salesforce" },
        ],
        kind: "capability",
      });
    }

    if (needsDecision) {
      const flavor = decisionFlavor(textBlob(snapshot));
      const hasRules = Boolean(snapshot.decisionConfig?.rules?.length);
      const hasInputs = Boolean(snapshot.decisionConfig?.inputs?.length);
      push({
        key: "decision_rules",
        category: "decision",
        label: flavor === "refund" ? "Refund policy" : flavor === "fraud" ? "Fraud rules" : "Decision rules",
        description: "How this agent should decide.",
        required: true,
        status: ready(hasRules || workflow.hasDecision || intent.wantsDecision),
        reason:
          flavor === "refund"
            ? "Refund decisions need eligibility and policy rules."
            : flavor === "fraud"
              ? "Fraud decisions need risk signals and thresholds."
              : "This agent makes a decision, so it needs rules or a scoring step.",
        configurationType: "none",
        actionHref:
          snapshot.kind === "decision"
            ? "/decision-agents"
            : `/agents/${encodeURIComponent(snapshot.agentId)}/workflow`,
      });
      if (flavor === "refund") {
        const refundFieldsReady =
          Boolean(ans(answers, "refund_customer") && ans(answers, "refund_amount")) || hasInputs || hasRules;
        push({
          key: "refund_input",
          category: "input",
          label: "Refund details",
          description: "Amount, customer, and eligibility fields for the refund.",
          required: true,
          status: ready(refundFieldsReady),
          reason: "The agent cannot approve a refund without the refund details.",
          configurationType: "none",
          countsTowardProgress: false,
        });
        push({
          key: "approval_threshold",
          category: "safety",
          label: "Human approval threshold",
          description: "When a refund should wait for a person.",
          required: true,
          status: ready(
            Boolean(snapshot.decisionConfig?.approvalWhen) || Boolean(snapshot.protectionConfigured)
          ),
          reason: "Automatic refunds need a cutoff for human review.",
          configurationType: "policy",
        });
      }
      if (flavor === "fraud") {
        push({
          key: "fraud_signals",
          category: "input",
          label: "Fraud signals",
          description: "Transaction, account, and risk inputs for this check.",
          required: true,
          status: ready(hasInputs || hasRules),
          reason: "Fraud decisions need the signals this agent was built to evaluate.",
          configurationType: "none",
        });
      }
    }

    const safetyNeeded = needsApproval || needsCrm || hasHighImpact(tools) || needsDecision;
    const safetyAnswer = ans(answers, "safety") || ans(answers, "crm_policy");
    const decisionSafetyReady =
      snapshot.kind === "decision" &&
      Boolean(
        snapshot.decisionConfig?.approvalWhen ||
          snapshot.decisionConfig?.riskLevel ||
          snapshot.decisionConfig?.rules?.length
      );
    push({
      key: "safety",
      category: "safety",
      label: safetyNeeded ? "Safety policy" : "Basic safety",
      description: safetyNeeded
        ? "How external or high-impact actions should be handled."
        : "Prompt and policy checks for this agent.",
      required: true,
      status: ready(
        !safetyNeeded ||
          Boolean(snapshot.protectionConfigured) ||
          workflow.hasSafety ||
          decisionSafetyReady ||
          Boolean(safetyAnswer)
      ),
      reason: safetyNeeded
        ? "This agent can take a high-impact action, so Wave needs a policy."
        : "Wave still applies basic protection even on low-risk research agents.",
      configurationType: safetyNeeded ? "policy" : "none",
      value: safetyAnswer || (safetyNeeded ? null : "allow"),
      options: safetyNeeded
        ? [
            { id: "allow", label: "Allow automatically" },
            { id: "ask", label: "Ask me first" },
            { id: "block", label: "Always block" },
          ]
        : undefined,
      countsTowardProgress: safetyNeeded,
      kind: "configuration",
      section: "safety",
      sectionTitle: "Safety",
      sectionDescription: safetyNeeded
        ? "How high-impact actions should be handled."
        : "Basic protection is already on.",
    });
  }

  if (stage === "deploy") {
    push({
      key: "deploy_environment",
      category: "deploy",
      label: "Production environment",
      description: "Confirm this agent should run in production.",
      required: true,
      status: "ready",
      reason: "Deployment is separate from testing, so Wave needs a production target.",
      configurationType: "none",
    });
    if (needsEmail || needsWhatsApp) {
      push({
        key: "production_credentials",
        category: "deploy",
        label: "Production credentials",
        description: "Live delivery credentials for this agent's output.",
        required: true,
        status: ready(
          (needsEmail ? snapshot.emailConnected !== false : true) &&
            (needsWhatsApp ? snapshot.whatsappConnected !== false : true)
        ),
        reason: "Production delivery uses live credentials, not the test defaults.",
        configurationType: "connection",
      });
    }
    push({
      key: "deploy_monitoring",
      category: "deploy",
      label: "Monitoring",
      description: "Watch live runs after you deploy.",
      required: true,
      status: "ready",
      reason: "Production deployment needs a place to review runs.",
      configurationType: "none",
      actionHref: "/monitor",
    });
  }

  const required = requirements.filter((item) => item.required);
  const missing = required.filter((item) => item.status === "missing");
  const progress = requirements.filter(countsTowardProgress);
  const progressReady = progress.filter((item) => item.status === "ready");

  return {
    agentId: snapshot.agentId,
    agentName: snapshot.name,
    jobProfile,
    requirements,
    sections: buildRequirementSections(requirements),
    testScenario: buildTestScenario(requirements),
    readyCount: progressReady.length,
    requiredCount: progress.length,
    missing,
    ready: missing.length === 0,
  };
}

function countsTowardProgress(item: AgentRequirement): boolean {
  if (item.countsTowardProgress === false) return false;
  if (!item.required) return false;
  if (item.countsTowardProgress === true) return true;
  if (item.inputType === "none" && item.status === "ready") return false;
  return true;
}

function buildRequirementSections(requirements: AgentRequirement[]): RequirementSection[] {
  const order: string[] = [];
  const map = new Map<string, RequirementSection>();
  for (const item of requirements) {
    if (item.inputType === "none" && item.status !== "missing") continue;
    const id = item.section || item.category;
    if (!map.has(id)) {
      order.push(id);
      map.set(id, {
        id,
        title: item.sectionTitle || fallbackSectionTitle(id),
        description: item.sectionDescription || "",
        keys: [],
      });
    }
    map.get(id)!.keys.push(item.key);
  }
  return order.map((id) => map.get(id)!);
}

function fallbackSectionTitle(id: string): string {
  const titles: Record<string, string> = {
    company: "Company information",
    contact: "Contact information",
    meeting: "Meeting details",
    research: "Research",
    briefing: "Briefing format",
    delivery: "How should the result be delivered?",
    output: "How should the result be delivered?",
    schedule: "Schedule",
    safety: "Safety",
    input: "Information this agent needs",
    integration: "Connections",
    tool: "Tools",
    workflow: "Workflow",
    decision: "Decision rules",
    external: "External connection",
    deploy: "Deployment",
  };
  return titles[id] ?? "Setup";
}

function optionLabel(item: AgentRequirement, value: string): string {
  const labels = (item.options ?? [])
    .filter((option) => value.split(",").includes(option.id))
    .map((option) => option.label);
  return labels.length ? labels.join(", ") : value;
}

function buildTestScenario(requirements: AgentRequirement[]): TestScenarioLine[] {
  const preferred = [
    "company_name",
    "contact_name",
    "contact_role",
    "contact_company",
    "meeting_date",
    "meeting_time",
    "meeting_type",
    "research_topic",
    "research",
    "research_news",
    "research_trends",
    "briefing_length",
    "briefing_format",
    "output_destination",
    "email",
    "whatsapp",
    "customer_identifier",
    "crm_fields",
    "urgency_condition",
    "refund_customer",
    "refund_amount",
    "story_count",
    "summary_length",
  ];
  const lines: TestScenarioLine[] = [];
  const seen = new Set<string>();
  for (const key of preferred) {
    const item = requirements.find((entry) => entry.key === key);
    if (!item?.value) continue;
    seen.add(key);
    lines.push({ label: item.label, value: optionLabel(item, item.value) });
  }
  for (const item of requirements) {
    if (seen.has(item.key)) continue;
    if (item.kind !== "business" || !item.required || !item.value) continue;
    if (item.inputType === "none") continue;
    lines.push({ label: item.label, value: optionLabel(item, item.value) });
  }
  return lines;
}
