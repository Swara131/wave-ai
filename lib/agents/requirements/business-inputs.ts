import type { AgentWorkflowGraph } from "@/lib/agents/workflow/types";
import type {
  AgentRequirement,
  RequirementDependency,
  RequirementInputType,
  RequirementKind,
  RequirementScope,
} from "./types";

export type JobProfile =
  | "sales_briefing"
  | "news_digest"
  | "competitor_research"
  | "crm_update"
  | "whatsapp_notify"
  | "refund"
  | "fraud"
  | "chatbot"
  | "url_summary"
  | "photo_concepts"
  | "lighting_concierge"
  | "travel_companion"
  | "wedding_planner"
  | "group_decision_planner"
  | "generic";

export interface BusinessFieldSpec {
  key: string;
  label: string;
  description: string;
  reason: string;
  type: RequirementInputType;
  required: boolean;
  section: string;
  sectionTitle: string;
  sectionDescription: string;
  placeholder?: string;
  options?: { id: string; label: string }[];
  dependsOn?: RequirementDependency;
  validation?: AgentRequirement["validation"];
  kind?: RequirementKind;
  scope?: RequirementScope;
}

export interface WorkflowJobHints {
  company: boolean;
  contact: boolean;
  meeting: boolean;
  research: boolean;
  briefing: boolean;
  email: boolean;
  crm: boolean;
  news: boolean;
  url: boolean;
}

export function extractWorkflowJobHints(graph: AgentWorkflowGraph | null | undefined): WorkflowJobHints {
  const blob = (graph?.nodes ?? [])
    .map((node) => `${node.name} ${node.description} ${node.type} ${node.config?.toolName ?? ""}`)
    .join(" ")
    .toLowerCase();
  return {
    company: /\bcompan/.test(blob),
    contact: /\bcontact|\bperson|\bwho you.re meeting/.test(blob),
    meeting: /\bmeeting|\bcall|\bdemo/.test(blob),
    research: /\bresearch|\bweb_search|\bsearch/.test(blob),
    briefing: /\bbrief|\btalking points|\bagenda/.test(blob),
    email: /\bemail|\boutput_email/.test(blob),
    crm: /\bcrm|\bupdate_crm/.test(blob),
    news: /\bnews|\bstories|\bdigest/.test(blob),
    url: /\bfetch_url|\bsource_url|\byoutube/.test(blob),
  };
}

export function looksLikePhotoJob(text: string): boolean {
  const t = text.toLowerCase();
  const hasPhoto = /\b(photo|photos|image|picture|jpg|jpeg|png|upload)\b/.test(t);
  const hasDesignJob =
    /\b(venue|decorat|concept|design|styling|interior|event space|pricing page)\b/.test(t);
  return hasPhoto && hasDesignJob;
}

export function looksLikeUrlSummaryJob(text: string, hints?: WorkflowJobHints): boolean {
  const t = text.toLowerCase();
  if (/\b(tickets?|helpdesk|help desk|crm|refund|fraud)\b/.test(t)) return false;
  if (hints?.url) return true;
  return (
    /\b(youtube|youtu\.be|tiktok|instagram|vimeo|linkedin|facebook)\b/.test(t) ||
    /\b(from (a |the )?(url|link)|paste (a |the )?link|platform link|video link)\b/.test(t) ||
    (/\bsummar/.test(t) && /\b(url|link|video|article|blog|web\s*page|webpage|podcast)\b/.test(t))
  );
}

export function inferJobProfile(text: string, hints: WorkflowJobHints): JobProfile {
  const t = text.toLowerCase();
  if (looksLikePhotoJob(text)) return "photo_concepts";
  if (
    /\blighting concierge\b/.test(t) ||
    (/\blighting\b/.test(t) && /\belectrician\b/.test(t))
  ) {
    return "lighting_concierge";
  }
  if (
    /\bwedding (& |and )?celebration planner\b/.test(t) ||
    /\bcelebration planner\b/.test(t)
  ) {
    return "wedding_planner";
  }
  if (/\bgroup decision planner\b/.test(t)) {
    return "group_decision_planner";
  }
  if (
    /\btravel companion\b/.test(t) ||
    (/\bitinerary\b/.test(t) && /\btravel\b/.test(t))
  ) {
    return "travel_companion";
  }
  if (looksLikeUrlSummaryJob(text, hints)) return "url_summary";
  if (/\brefund\b/.test(t)) return "refund";
  if (/\bfraud\b/.test(t)) return "fraud";
  if (/\bwhatsapp\b/.test(t) && /\bticket/.test(t) && !/\bupdate customer records/.test(t)) {
    return "whatsapp_notify";
  }
  if (/\bcustomer records?\b/.test(t) || (/\bcrm\b/.test(t) && /\bticket/.test(t))) {
    return "crm_update";
  }
  const briefing =
    (/\bbriefs?\b/.test(t) && (/\bcompan/.test(t) || /\bcontact/.test(t) || /\bmeeting/.test(t))) ||
    (/\bsales (call|meeting)\b/.test(t) && /\bbrief/.test(t)) ||
    (hints.briefing && (hints.company || hints.contact || hints.meeting));
  if (briefing) return "sales_briefing";
  if (/\bcompetitors?\b/.test(t) || (hints.research && /\bcompetitor/.test(t))) return "competitor_research";
  if (
    /\b(news|stories|digest|headlines)\b/.test(t) ||
    (/\blatest\b/.test(t) && /\bsummar/.test(t)) ||
    hints.news
  ) {
    return "news_digest";
  }
  if (/\b(chatbot|help center|answer customer questions|in the product)\b/.test(t)) return "chatbot";
  return "generic";
}

const DATA_SOURCE_OPTIONS = [
  { id: "manual", label: "Information entered here" },
  { id: "crm", label: "CRM" },
  { id: "website", label: "Website" },
  { id: "api", label: "API" },
  { id: "csv", label: "CSV" },
];

function field(spec: BusinessFieldSpec): BusinessFieldSpec {
  return spec;
}

export function businessFieldsForJob(profile: JobProfile): BusinessFieldSpec[] {
  if (profile === "sales_briefing") return salesBriefingFields();
  if (
    profile === "photo_concepts" ||
    profile === "lighting_concierge" ||
    profile === "travel_companion" ||
    profile === "wedding_planner" ||
    profile === "group_decision_planner"
  ) {
    return [];
  }
  if (profile === "url_summary") return urlSummaryFields();
  if (profile === "news_digest") return newsDigestFields();
  if (profile === "competitor_research") return competitorFields();
  if (profile === "crm_update") return crmFields();
  if (profile === "whatsapp_notify") return whatsappFields();
  if (profile === "refund") return refundFields();
  if (profile === "fraud") return fraudFields();
  return [];
}

function contactInformationFields(): BusinessFieldSpec[] {
  return [
    field({
      key: "contact_name",
      label: "Contact name",
      description: "Who are you meeting?",
      reason: "A sales briefing needs the actual person, not just the company.",
      type: "text",
      required: true,
      section: "contact",
      sectionTitle: "Contact information",
      sectionDescription: "Who are you meeting?",
      placeholder: "Jane Smith",
      kind: "business",
    }),
    field({
      key: "contact_role",
      label: "Job title / role",
      description: "Their role.",
      reason: "The briefing should match their seniority and job.",
      type: "text",
      required: true,
      section: "contact",
      sectionTitle: "Contact information",
      sectionDescription: "Who are you meeting?",
      placeholder: "VP of Sales",
      kind: "business",
    }),
    field({
      key: "contact_email",
      label: "Contact email",
      description: "Optional email.",
      reason: "Useful if the briefing mentions how to follow up.",
      type: "email",
      required: false,
      section: "contact",
      sectionTitle: "Contact information",
      sectionDescription: "Who are you meeting?",
      validation: "email",
      kind: "business",
    }),
    field({
      key: "contact_linkedin",
      label: "LinkedIn profile",
      description: "Optional profile URL.",
      reason: "Helps research the person.",
      type: "url",
      required: false,
      section: "contact",
      sectionTitle: "Contact information",
      sectionDescription: "Who are you meeting?",
      validation: "url",
      kind: "business",
    }),
    field({
      key: "contact_company",
      label: "Company",
      description: "Pre-filled from company information when possible.",
      reason: "The contact should be tied to the company you are meeting.",
      type: "text",
      required: false,
      section: "contact",
      sectionTitle: "Contact information",
      sectionDescription: "Who are you meeting?",
      kind: "business",
    }),
    field({
      key: "contact_background",
      label: "What do you already know about this person?",
      description: "Optional background.",
      reason: "The agent should not ignore what you already know.",
      type: "textarea",
      required: false,
      section: "contact",
      sectionTitle: "Contact information",
      sectionDescription: "Who are you meeting?",
      kind: "business",
    }),
    field({
      key: "contact_source",
      label: "Where should contact data come from?",
      description: "Choose a source.",
      reason: "Contact details can come from what you enter or from another system.",
      type: "choice",
      required: true,
      section: "contact",
      sectionTitle: "Contact information",
      sectionDescription: "Who are you meeting?",
      options: DATA_SOURCE_OPTIONS.filter((item) => item.id !== "website"),
      kind: "configuration",
    }),
    field({
      key: "contact_api_endpoint",
      label: "API for contact data",
      description: "Where the agent should load the contact.",
      reason: "You chose an API as the contact data source.",
      type: "url",
      required: true,
      section: "contact",
      sectionTitle: "Contact information",
      sectionDescription: "Who are you meeting?",
      placeholder: "https://",
      validation: "url",
      dependsOn: { key: "contact_source", equals: "api" },
      kind: "configuration",
    }),
  ];
}

function salesBriefingFields(): BusinessFieldSpec[] {
  return [
    field({
      key: "company_name",
      label: "Company name",
      description: "Tell the agent which company you are preparing for.",
      reason: "The agent needs a company to prepare the briefing.",
      type: "text",
      required: true,
      section: "company",
      sectionTitle: "Company information",
      sectionDescription: "Tell the agent which company you are preparing for.",
      placeholder: "Acme Technologies",
      kind: "business",
    }),
    field({
      key: "company_website",
      label: "Company website",
      description: "Optional website for research.",
      reason: "A website helps the agent research the company.",
      type: "url",
      required: false,
      section: "company",
      sectionTitle: "Company information",
      sectionDescription: "Tell the agent which company you are preparing for.",
      placeholder: "https://example.com",
      validation: "url",
      kind: "business",
    }),
    field({
      key: "company_linkedin",
      label: "Company LinkedIn profile",
      description: "Optional LinkedIn URL.",
      reason: "LinkedIn helps fill in company context.",
      type: "url",
      required: false,
      section: "company",
      sectionTitle: "Company information",
      sectionDescription: "Tell the agent which company you are preparing for.",
      placeholder: "https://linkedin.com/company/example",
      validation: "url",
      kind: "business",
    }),
    field({
      key: "company_industry",
      label: "Industry",
      description: "Optional industry.",
      reason: "Industry context improves the briefing.",
      type: "text",
      required: false,
      section: "company",
      sectionTitle: "Company information",
      sectionDescription: "Tell the agent which company you are preparing for.",
      placeholder: "SaaS",
      kind: "business",
    }),
    field({
      key: "company_size",
      label: "Company size",
      description: "Optional size.",
      reason: "Company size changes how you sell.",
      type: "text",
      required: false,
      section: "company",
      sectionTitle: "Company information",
      sectionDescription: "Tell the agent which company you are preparing for.",
      placeholder: "200–500 employees",
      kind: "business",
    }),
    field({
      key: "company_location",
      label: "Location",
      description: "Optional location.",
      reason: "Location can affect timing and context.",
      type: "text",
      required: false,
      section: "company",
      sectionTitle: "Company information",
      sectionDescription: "Tell the agent which company you are preparing for.",
      kind: "business",
    }),
    field({
      key: "company_notes",
      label: "Recent company information you'd like highlighted",
      description: "Optional notes.",
      reason: "Anything you already know should be in the brief.",
      type: "textarea",
      required: false,
      section: "company",
      sectionTitle: "Company information",
      sectionDescription: "Tell the agent which company you are preparing for.",
      kind: "business",
    }),
    field({
      key: "company_source",
      label: "Where should company data come from?",
      description: "Choose a source.",
      reason: "The agent needs to know whether to use what you entered or another system.",
      type: "choice",
      required: true,
      section: "company",
      sectionTitle: "Company information",
      sectionDescription: "Tell the agent which company you are preparing for.",
      options: DATA_SOURCE_OPTIONS,
      kind: "configuration",
    }),
    field({
      key: "company_api_endpoint",
      label: "API for company data",
      description: "Where the agent should load company records.",
      reason: "You chose an API as the company data source.",
      type: "url",
      required: true,
      section: "company",
      sectionTitle: "Company information",
      sectionDescription: "Tell the agent which company you are preparing for.",
      placeholder: "https://",
      validation: "url",
      dependsOn: { key: "company_source", equals: "api" },
      kind: "configuration",
    }),
    ...contactInformationFields(),
    field({
      key: "meeting_date",
      label: "Meeting date",
      description: "When the meeting happens.",
      reason: "The briefing is for a specific meeting.",
      type: "date",
      required: true,
      section: "meeting",
      sectionTitle: "Meeting details",
      sectionDescription: "When you are meeting and what you want to accomplish.",
      kind: "business",
    }),
    field({
      key: "meeting_time",
      label: "Meeting time",
      description: "Optional time.",
      reason: "Helps place the meeting in your day.",
      type: "time",
      required: false,
      section: "meeting",
      sectionTitle: "Meeting details",
      sectionDescription: "When you are meeting and what you want to accomplish.",
      kind: "business",
    }),
    field({
      key: "meeting_timezone",
      label: "Timezone",
      description: "Meeting timezone.",
      reason: "Times only make sense with a timezone.",
      type: "timezone",
      required: false,
      section: "meeting",
      sectionTitle: "Meeting details",
      sectionDescription: "When you are meeting and what you want to accomplish.",
      placeholder: "Asia/Kolkata",
      kind: "business",
    }),
    field({
      key: "meeting_type",
      label: "Meeting type",
      description: "What kind of call this is.",
      reason: "Discovery, demo, and negotiation briefs are different.",
      type: "choice",
      required: true,
      section: "meeting",
      sectionTitle: "Meeting details",
      sectionDescription: "When you are meeting and what you want to accomplish.",
      options: [
        { id: "discovery", label: "Intro / discovery call" },
        { id: "demo", label: "Demo" },
        { id: "follow_up", label: "Follow-up" },
        { id: "negotiation", label: "Negotiation" },
        { id: "renewal", label: "Renewal" },
        { id: "other", label: "Other" },
      ],
      kind: "business",
    }),
    field({
      key: "meeting_location",
      label: "Meeting location",
      description: "How you will meet.",
      reason: "Video, phone, and in-person meetings need different prep.",
      type: "choice",
      required: false,
      section: "meeting",
      sectionTitle: "Meeting details",
      sectionDescription: "When you are meeting and what you want to accomplish.",
      options: [
        { id: "video", label: "Video call" },
        { id: "phone", label: "Phone" },
        { id: "in_person", label: "In person" },
      ],
      kind: "business",
    }),
    field({
      key: "meeting_platform",
      label: "Meeting platform",
      description: "Optional platform.",
      reason: "Useful if the brief should mention how you will join.",
      type: "text",
      required: false,
      section: "meeting",
      sectionTitle: "Meeting details",
      sectionDescription: "When you are meeting and what you want to accomplish.",
      placeholder: "Zoom / Google Meet / Teams",
      kind: "business",
    }),
    field({
      key: "meeting_agenda",
      label: "Meeting agenda",
      description: "Optional agenda.",
      reason: "An agenda tells the briefing what will be discussed.",
      type: "textarea",
      required: false,
      section: "meeting",
      sectionTitle: "Meeting details",
      sectionDescription: "When you are meeting and what you want to accomplish.",
      kind: "business",
    }),
    field({
      key: "meeting_goal",
      label: "What do you want to accomplish in this meeting?",
      description: "Meeting objective.",
      reason: "The briefing should aim at your goal, not a generic summary.",
      type: "textarea",
      required: false,
      section: "meeting",
      sectionTitle: "Meeting details",
      sectionDescription: "When you are meeting and what you want to accomplish.",
      kind: "business",
    }),
    field({
      key: "meeting_focus",
      label: "What topics or questions should the briefing focus on?",
      description: "Focus areas.",
      reason: "Tells the agent what to emphasize.",
      type: "textarea",
      required: false,
      section: "meeting",
      sectionTitle: "Meeting details",
      sectionDescription: "When you are meeting and what you want to accomplish.",
      kind: "business",
    }),
    field({
      key: "meeting_talking_points",
      label: "Any specific talking points?",
      description: "Optional talking points.",
      reason: "Include points you already want covered.",
      type: "textarea",
      required: false,
      section: "meeting",
      sectionTitle: "Meeting details",
      sectionDescription: "When you are meeting and what you want to accomplish.",
      kind: "business",
    }),
    field({
      key: "research",
      label: "Should the agent research publicly available information?",
      description: "Enable web research for this briefing.",
      reason: "Your agent can look up current company and contact information if you want it to.",
      type: "choice",
      required: true,
      section: "research",
      sectionTitle: "Research",
      sectionDescription: "Choose how much public information the agent should look up.",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
      kind: "configuration",
    }),
    field({
      key: "research_company",
      label: "Research company",
      description: "Look up public company information.",
      reason: "Company research fills the company overview.",
      type: "choice",
      required: false,
      section: "research",
      sectionTitle: "Research",
      sectionDescription: "Choose how much public information the agent should look up.",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
      dependsOn: { key: "research", equals: "yes" },
      kind: "configuration",
    }),
    field({
      key: "research_contact",
      label: "Research contact",
      description: "Look up public information about the person.",
      reason: "Contact research fills the person overview.",
      type: "choice",
      required: false,
      section: "research",
      sectionTitle: "Research",
      sectionDescription: "Choose how much public information the agent should look up.",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
      dependsOn: { key: "research", equals: "yes" },
      kind: "configuration",
    }),
    field({
      key: "research_news",
      label: "Research recent company news",
      description: "Include recent news.",
      reason: "News makes the briefing timely.",
      type: "choice",
      required: false,
      section: "research",
      sectionTitle: "Research",
      sectionDescription: "Choose how much public information the agent should look up.",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
      dependsOn: { key: "research", equals: "yes" },
      kind: "configuration",
    }),
    field({
      key: "research_competitors",
      label: "Research competitors",
      description: "Include competitor context.",
      reason: "Useful before a competitive conversation.",
      type: "choice",
      required: false,
      section: "research",
      sectionTitle: "Research",
      sectionDescription: "Choose how much public information the agent should look up.",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
      dependsOn: { key: "research", equals: "yes" },
      kind: "configuration",
    }),
    field({
      key: "research_funding",
      label: "Research funding / financial information",
      description: "Include funding context.",
      reason: "Financial context can change the conversation.",
      type: "choice",
      required: false,
      section: "research",
      sectionTitle: "Research",
      sectionDescription: "Choose how much public information the agent should look up.",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
      dependsOn: { key: "research", equals: "yes" },
      kind: "configuration",
    }),
    field({
      key: "research_products",
      label: "Research recent product launches",
      description: "Include product news.",
      reason: "New products often drive meeting topics.",
      type: "choice",
      required: false,
      section: "research",
      sectionTitle: "Research",
      sectionDescription: "Choose how much public information the agent should look up.",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
      dependsOn: { key: "research", equals: "yes" },
      kind: "configuration",
    }),
    field({
      key: "research_trends",
      label: "Research industry trends",
      description: "Include industry context.",
      reason: "Trends help you sound informed.",
      type: "choice",
      required: false,
      section: "research",
      sectionTitle: "Research",
      sectionDescription: "Choose how much public information the agent should look up.",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
      dependsOn: { key: "research", equals: "yes" },
      kind: "configuration",
    }),
    field({
      key: "research_depth",
      label: "Research depth",
      description: "How thorough the research should be.",
      reason: "Quick, standard, and deep briefs take different effort.",
      type: "choice",
      required: true,
      section: "research",
      sectionTitle: "Research",
      sectionDescription: "Choose how much public information the agent should look up.",
      options: [
        { id: "quick", label: "Quick" },
        { id: "standard", label: "Standard" },
        { id: "deep", label: "Deep" },
      ],
      dependsOn: { key: "research", equals: "yes" },
      kind: "configuration",
    }),
    field({
      key: "briefing_contents",
      label: "What should the briefing contain?",
      description: "Choose sections to include.",
      reason: "The briefing should only include what you need.",
      type: "checkbox",
      required: true,
      section: "briefing",
      sectionTitle: "Briefing format",
      sectionDescription: "What the generated briefing should contain.",
      options: [
        { id: "company_overview", label: "Company overview" },
        { id: "contact_overview", label: "Contact overview" },
        { id: "recent_news", label: "Recent company news" },
        { id: "contact_background", label: "Contact background" },
        { id: "objectives", label: "Meeting objectives" },
        { id: "talking_points", label: "Suggested talking points" },
        { id: "questions", label: "Questions to ask" },
        { id: "objections", label: "Potential objections" },
        { id: "competitors", label: "Competitor context" },
      ],
      kind: "configuration",
    }),
    field({
      key: "briefing_length",
      label: "Briefing length",
      description: "How long the briefing should be.",
      reason: "Short and detailed briefs are different documents.",
      type: "choice",
      required: true,
      section: "briefing",
      sectionTitle: "Briefing format",
      sectionDescription: "What the generated briefing should contain.",
      options: [
        { id: "short", label: "Short" },
        { id: "standard", label: "Standard" },
        { id: "detailed", label: "Detailed" },
      ],
      kind: "configuration",
    }),
    field({
      key: "briefing_format",
      label: "Format",
      description: "How the briefing should be written.",
      reason: "This changes the generated output.",
      type: "choice",
      required: true,
      section: "briefing",
      sectionTitle: "Briefing format",
      sectionDescription: "What the generated briefing should contain.",
      options: [
        { id: "structured", label: "Structured briefing" },
        { id: "bullets", label: "Bullet points" },
        { id: "executive", label: "Executive summary" },
        { id: "custom", label: "Custom" },
      ],
      kind: "configuration",
    }),
  ];
}

function urlSummaryFields(): BusinessFieldSpec[] {
  return [
    field({
      key: "source_url",
      label: "Link to summarize",
      description: "Paste a YouTube, article, or other public URL. Wave will read that page — it will not invent a summary.",
      reason: "This agent needs a real link each time it runs.",
      type: "url",
      required: true,
      section: "run_input",
      sectionTitle: "What should this run summarize?",
      sectionDescription: "Paste a public link. Wave fetches the page or video metadata and summarizes only what it can actually read.",
      placeholder: "https://www.youtube.com/watch?v=…",
      validation: "url",
      kind: "business",
      scope: "run",
    }),
    field({
      key: "summary_focus",
      label: "What should the summary emphasize?",
      description: "Optional focus, such as key points, claims, or action items.",
      reason: "Helps the summary match what you need without guessing extra facts.",
      type: "textarea",
      required: false,
      section: "run_input",
      sectionTitle: "What should this run summarize?",
      sectionDescription: "Paste a public link. Wave fetches the page or video metadata and summarizes only what it can actually read.",
      placeholder: "Key arguments and timestamps if available",
      kind: "business",
      scope: "run",
    }),
    field({
      key: "summary_length",
      label: "Summary length",
      description: "How long the summary should be.",
      reason: "Short and detailed summaries are different outputs.",
      type: "choice",
      required: true,
      section: "run_input",
      sectionTitle: "What should this run summarize?",
      sectionDescription: "Paste a public link. Wave fetches the page or video metadata and summarizes only what it can actually read.",
      options: [
        { id: "short", label: "Short" },
        { id: "standard", label: "Standard" },
        { id: "detailed", label: "Detailed" },
      ],
      kind: "configuration",
      scope: "run",
    }),
  ];
}

function newsDigestFields(): BusinessFieldSpec[] {
  return [
    field({
      key: "research_topic",
      label: "Research topic",
      description: "What should the agent look up?",
      reason: "A research agent needs a topic to search.",
      type: "text",
      required: true,
      section: "research_job",
      sectionTitle: "Research",
      sectionDescription: "Tell the agent what to find and how to summarize it.",
      placeholder: "Latest AI news",
      kind: "business",
    }),
    field({
      key: "research_sources",
      label: "Preferred sources",
      description: "Optional sites or types of sources.",
      reason: "You can steer which publications to prefer.",
      type: "textarea",
      required: false,
      section: "research_job",
      sectionTitle: "Research",
      sectionDescription: "Tell the agent what to find and how to summarize it.",
      placeholder: "Tech press, company blogs",
      kind: "business",
    }),
    field({
      key: "story_count",
      label: "Number of stories",
      description: "How many items to include.",
      reason: "The summary length depends on how many stories you want.",
      type: "select",
      required: true,
      section: "research_job",
      sectionTitle: "Research",
      sectionDescription: "Tell the agent what to find and how to summarize it.",
      options: [
        { id: "3", label: "Top 3" },
        { id: "5", label: "Top 5" },
        { id: "10", label: "Top 10" },
      ],
      kind: "business",
    }),
    field({
      key: "summary_length",
      label: "Summary length",
      description: "How long each summary should be.",
      reason: "Short and detailed summaries are different outputs.",
      type: "choice",
      required: true,
      section: "research_job",
      sectionTitle: "Research",
      sectionDescription: "Tell the agent what to find and how to summarize it.",
      options: [
        { id: "short", label: "Short" },
        { id: "standard", label: "Standard" },
        { id: "detailed", label: "Detailed report" },
      ],
      kind: "configuration",
    }),
  ];
}

function competitorFields(): BusinessFieldSpec[] {
  return [
    field({
      key: "research_topic",
      label: "Competitors to research",
      description: "Who should be included?",
      reason: "The agent needs to know which competitors to cover.",
      type: "textarea",
      required: true,
      section: "research_job",
      sectionTitle: "Competitor research",
      sectionDescription: "Tell the agent which companies to research and how to report.",
      placeholder: "Competitor names or market",
      kind: "business",
    }),
    field({
      key: "summary_length",
      label: "Report format",
      description: "How detailed the report should be.",
      reason: "This shapes the generated report.",
      type: "choice",
      required: true,
      section: "research_job",
      sectionTitle: "Competitor research",
      sectionDescription: "Tell the agent which companies to research and how to report.",
      options: [
        { id: "short", label: "Short summary" },
        { id: "standard", label: "Standard report" },
        { id: "detailed", label: "Detailed report" },
      ],
      kind: "configuration",
    }),
  ];
}

function crmFields(): BusinessFieldSpec[] {
  return [
    field({
      key: "customer_identifier",
      label: "How are customers identified?",
      description: "Email, ticket ID, or CRM ID.",
      reason: "The agent must know which customer record to update.",
      type: "text",
      required: true,
      section: "crm_job",
      sectionTitle: "Customer and ticket details",
      sectionDescription: "What the agent should change when a ticket is resolved.",
      placeholder: "Customer email or CRM ID",
      kind: "business",
    }),
    field({
      key: "crm_fields",
      label: "Fields to update",
      description: "Which record fields should change.",
      reason: "The agent should only update the fields you allow.",
      type: "textarea",
      required: true,
      section: "crm_job",
      sectionTitle: "Customer and ticket details",
      sectionDescription: "What the agent should change when a ticket is resolved.",
      placeholder: "Status, resolution notes, satisfaction",
      kind: "business",
    }),
    field({
      key: "resolution_details",
      label: "Resolution details",
      description: "What a resolved ticket should record.",
      reason: "Resolved tickets need a resolution note.",
      type: "textarea",
      required: false,
      section: "crm_job",
      sectionTitle: "Customer and ticket details",
      sectionDescription: "What the agent should change when a ticket is resolved.",
      kind: "business",
    }),
    field({
      key: "satisfaction_rating",
      label: "Capture satisfaction rating?",
      description: "Whether to store a rating.",
      reason: "Some CRM updates include CSAT.",
      type: "choice",
      required: false,
      section: "crm_job",
      sectionTitle: "Customer and ticket details",
      sectionDescription: "What the agent should change when a ticket is resolved.",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
      kind: "configuration",
    }),
  ];
}

function whatsappFields(): BusinessFieldSpec[] {
  return [
    field({
      key: "urgency_condition",
      label: "When is a ticket urgent?",
      description: "The condition that should trigger a message.",
      reason: "The agent needs to know what “urgent” means for you.",
      type: "textarea",
      required: true,
      section: "notify_job",
      sectionTitle: "Urgent ticket alerts",
      sectionDescription: "When to notify you and what the message should say.",
      placeholder: "Priority is Urgent or P1",
      kind: "business",
    }),
    field({
      key: "message_format",
      label: "Message format",
      description: "What the WhatsApp message should include.",
      reason: "The notification should contain the fields you care about.",
      type: "textarea",
      required: true,
      section: "notify_job",
      sectionTitle: "Urgent ticket alerts",
      sectionDescription: "When to notify you and what the message should say.",
      placeholder: "Ticket ID, customer, urgency reason",
      kind: "business",
    }),
  ];
}

function refundFields(): BusinessFieldSpec[] {
  return [
    field({
      key: "refund_customer",
      label: "Customer identifier",
      description: "How the customer is identified.",
      reason: "A refund decision needs the customer.",
      type: "text",
      required: true,
      section: "refund_job",
      sectionTitle: "Refund decision inputs",
      sectionDescription: "Information this decision needs before it can run.",
      kind: "business",
    }),
    field({
      key: "refund_amount",
      label: "Typical refund amount or currency",
      description: "Amount context for testing.",
      reason: "Refund rules usually depend on amount.",
      type: "text",
      required: true,
      section: "refund_job",
      sectionTitle: "Refund decision inputs",
      sectionDescription: "Information this decision needs before it can run.",
      placeholder: "INR 5,000",
      kind: "business",
    }),
    field({
      key: "refund_policy_notes",
      label: "Refund policy notes",
      description: "Any extra policy the agent should follow.",
      reason: "Policy notes steer automatic approvals.",
      type: "textarea",
      required: false,
      section: "refund_job",
      sectionTitle: "Refund decision inputs",
      sectionDescription: "Information this decision needs before it can run.",
      kind: "business",
    }),
  ];
}

function fraudFields(): BusinessFieldSpec[] {
  return [
    field({
      key: "transaction_context",
      label: "Transaction details to evaluate",
      description: "What a test transaction looks like.",
      reason: "Fraud decisions need transaction context.",
      type: "textarea",
      required: true,
      section: "fraud_job",
      sectionTitle: "Fraud decision inputs",
      sectionDescription: "Signals this agent should consider.",
      kind: "business",
    }),
    field({
      key: "fraud_signals_notes",
      label: "Fraud signals to watch",
      description: "Optional extra signals.",
      reason: "You can highlight the signals that matter most.",
      type: "textarea",
      required: false,
      section: "fraud_job",
      sectionTitle: "Fraud decision inputs",
      sectionDescription: "Signals this agent should consider.",
      kind: "business",
    }),
  ];
}

export function fieldIsVisible(spec: BusinessFieldSpec, answers: Record<string, string>): boolean {
  if (!spec.dependsOn) return true;
  return (answers[spec.dependsOn.key] ?? "").trim() === spec.dependsOn.equals;
}
