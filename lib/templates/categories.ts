import type { TemplateFilterId, TemplateListQuery, AgentTemplate } from "./types";

export interface TemplateFilterOption {
  id: TemplateFilterId;
  label: string;
}

export const TEMPLATE_FILTERS: TemplateFilterOption[] = [
  { id: "all", label: "All Templates" },
  { id: "sales-marketing", label: "Sales & Marketing" },
  { id: "customer-support", label: "Customer Support" },
  { id: "operations-productivity", label: "Operations & Productivity" },
  { id: "finance-commerce", label: "Finance & Commerce" },
  { id: "developer-ai-safety", label: "Developer & AI Safety" },
  { id: "home-services", label: "Home Services / Smart Recommendations" },
  { id: "travel-lifestyle", label: "Travel & Lifestyle" },
  { id: "events-planning", label: "Events & Planning" },
];

export const MARKETPLACE_CATEGORY_LABELS: Record<Exclude<TemplateFilterId, "all">, string> = {
  "sales-marketing": "Sales & Marketing",
  "customer-support": "Customer Support",
  "operations-productivity": "Operations & Productivity",
  "finance-commerce": "Finance & Commerce",
  "developer-ai-safety": "Developer & AI Safety",
  "home-services": "Home Services / Smart Recommendations",
  "travel-lifestyle": "Travel & Lifestyle",
  "events-planning": "Events & Planning",
};

export function matchesTemplateFilter(
  category: string,
  filter: TemplateFilterId | string | null | undefined
): boolean {
  if (!filter || filter === "all") return true;
  return category === filter;
}

export function filterTemplates(
  templates: AgentTemplate[],
  params?: TemplateListQuery
): AgentTemplate[] {
  const search = params?.search?.trim().toLowerCase() ?? "";
  const category = params?.category ?? "all";
  const risk = params?.riskLevel && params.riskLevel !== "all" ? params.riskLevel : null;
  const requiresApproval = params?.requiresApproval;
  const tool = params?.tool?.trim().toLowerCase() ?? "";

  return templates.filter((template) => {
    if (template.isPublished === false) return false;
    if (!matchesTemplateFilter(template.category, category as TemplateFilterId)) {
      return false;
    }
    if (risk && template.riskLevel !== risk) return false;
    if (requiresApproval === true && template.requiresApproval !== true) return false;
    if (requiresApproval === false && template.requiresApproval === true) return false;
    if (tool) {
      const toolHaystack = [
        ...template.tools,
        ...(template.suggestedIntegrations ?? []),
      ]
        .join(" ")
        .toLowerCase();
      if (!toolHaystack.includes(tool)) return false;
    }
    if (!search) return true;
    const haystack = [
      template.name,
      template.description,
      template.summary,
      template.shortDescription,
      template.longDescription,
      template.category,
      ...(template.tags ?? []),
      ...(template.exampleTasks ?? []),
      ...(template.suggestedIntegrations ?? []),
      ...template.tools,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(search);
  });
}

export function countTemplatesByCategory(templates: AgentTemplate[]): Record<TemplateFilterId, number> {
  const published = templates.filter((template) => template.isPublished !== false);
  const counts = {
    all: published.length,
    "sales-marketing": 0,
    "customer-support": 0,
    "operations-productivity": 0,
    "finance-commerce": 0,
    "developer-ai-safety": 0,
    "home-services": 0,
    "travel-lifestyle": 0,
    "events-planning": 0,
  } as Record<TemplateFilterId, number>;

  for (const template of published) {
    if (template.category in counts) {
      counts[template.category as TemplateFilterId] += 1;
    }
  }
  return counts;
}
