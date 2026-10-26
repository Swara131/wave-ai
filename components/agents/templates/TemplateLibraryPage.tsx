"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutTemplate, Loader2, Search, Shield } from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import TemplateCustomizeModal from "./TemplateCustomizeModal";
import TemplatePreviewModal from "./TemplatePreviewModal";
import { getTemplateIcon } from "./template-icons";
import { AGENT_CREATED_TOAST_KEY } from "@/components/agent-builder/AgentBuilderModal";
import { saveCreatedAgentSession } from "@/lib/agent-builder/created-agent-session";
import { saveAgentLifecycle } from "@/lib/agent-builder/agent-lifecycle";
import { saveAgentConfigFromCreate } from "@/lib/agents/load-agent-setup-config";
import { createStandaloneLifecyclePatch } from "@/lib/agents/agent-mode";
import { COMPANY_NAME } from "@/lib/public-branding";
import {
  countTemplatesByCategory,
  MARKETPLACE_CATEGORY_LABELS,
  TEMPLATE_FILTERS,
} from "@/lib/templates/categories";
import { MARKETPLACE_TEMPLATES } from "@/lib/templates/marketplace-catalog";
import { filterTemplates } from "@/lib/templates/categories";
import type {
  AgentTemplate,
  MarketplaceCategory,
  TemplateFilterId,
  TemplateRiskLevel,
} from "@/lib/templates/types";
import type { AgentSpec } from "@/lib/agent-builder/types";
import { FLOW_ERRORS } from "@/lib/ux/flow-copy";

const RISK_FILTERS: { id: "all" | TemplateRiskLevel; label: string }[] = [
  { id: "all", label: "All risk" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

export default function TemplateLibraryPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<AgentTemplate[]>(MARKETPLACE_TEMPLATES);
  const [counts, setCounts] = useState(countTemplatesByCategory(MARKETPLACE_TEMPLATES));
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<TemplateFilterId>("all");
  const [risk, setRisk] = useState<"all" | TemplateRiskLevel>("all");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [toolFilter, setToolFilter] = useState("");
  const [preview, setPreview] = useState<AgentTemplate | null>(null);
  const [customize, setCustomize] = useState<AgentTemplate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category !== "all") params.set("category", category);
      if (search.trim()) params.set("search", search.trim());
      if (risk !== "all") params.set("risk", risk);
      if (requiresApproval) params.set("requiresApproval", "true");
      if (toolFilter.trim()) params.set("tool", toolFilter.trim());
      const query = params.toString();
      const response = await fetch(query ? `/api/v1/templates?${query}` : "/api/v1/templates");
      if (response.ok) {
        const payload = (await response.json()) as {
          templates?: AgentTemplate[];
          counts?: typeof counts;
        };
        if (payload.templates?.length) setTemplates(payload.templates);
        if (payload.counts) setCounts(payload.counts);
      }
    } finally {
      setLoading(false);
    }
  }, [category, search, risk, requiresApproval, toolFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTemplates();
    }, search || toolFilter ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [loadTemplates, search, toolFilter]);

  const visibleTemplates = useMemo(
    () =>
      filterTemplates(templates, {
        category,
        search,
        riskLevel: risk,
        requiresApproval: requiresApproval ? true : null,
        tool: toolFilter,
      }),
    [templates, category, search, risk, requiresApproval, toolFilter]
  );

  const filtersActive =
    category !== "all" || risk !== "all" || requiresApproval || Boolean(search.trim()) || Boolean(toolFilter.trim());

  const clearFilters = () => {
    setCategory("all");
    setRisk("all");
    setRequiresApproval(false);
    setSearch("");
    setToolFilter("");
  };

  const handleCreateFromTemplate = async (
    selectedTemplate: AgentTemplate,
    values: {
      threshold?: number;
      needsApproval: boolean;
      customInstructions: string;
    }
  ) => {
    setSubmitting(true);
    setModalError(null);
    try {
      const response = await fetch("/api/v1/agents/create-from-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: selectedTemplate.id,
          customizations: values,
        }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        agentId?: string;
        apiKey?: string;
        keyPrefix?: string;
        name?: string;
        description?: string;
        tools?: string[];
        triggerType?: string;
        suggestedThreshold?: number;
        templateName?: string;
        spec?: AgentSpec;
        error?: string;
      };
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error ?? FLOW_ERRORS.createAgent);
      }
      if (!payload.agentId || !payload.apiKey || !payload.spec || !payload.name) {
        throw new Error(FLOW_ERRORS.createAgent);
      }
      saveCreatedAgentSession({
        agentId: payload.agentId,
        plainKey: payload.apiKey,
        keyPrefix: payload.keyPrefix ?? "",
        spec: payload.spec,
        createdAt: new Date().toISOString(),
        templateName: payload.templateName ?? selectedTemplate.name,
        templateSlug: selectedTemplate.slug ?? selectedTemplate.id,
      });
      saveAgentConfigFromCreate({
        agentId: payload.agentId,
        name: payload.name,
        description: payload.description ?? selectedTemplate.summary,
        purpose: payload.description ?? selectedTemplate.summary,
        triggerType: payload.triggerType ?? selectedTemplate.triggerType,
        tools: payload.tools ?? selectedTemplate.tools,
        suggestedThreshold: payload.suggestedThreshold ?? selectedTemplate.defaultThreshold ?? 5000,
      });
      saveAgentLifecycle(payload.agentId, {
        ...createStandaloneLifecyclePatch(),
        actionsConfigured: true,
      });
      sessionStorage.setItem(
        AGENT_CREATED_TOAST_KEY,
        `✓ Agent created from '${payload.templateName ?? selectedTemplate.name}' template`
      );
      router.push(`/agents/${encodeURIComponent(payload.agentId)}/setup?from=template`);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : FLOW_ERRORS.createAgent);
      setSubmitting(false);
    }
  };

  const applyTemplateDefaults = (template: AgentTemplate) => {
    void handleCreateFromTemplate(template, {
      needsApproval: template.requiresApproval === true || template.riskLevel === "high",
      customInstructions: "",
      threshold: template.defaultThreshold ?? undefined,
    });
  };

  return (
    <PageShell maxWidth="6xl" className="ztemplates-page">
      <header className="ztpl-hero">
        <p className="ztpl-kicker">
          <LayoutTemplate className="h-4 w-4" aria-hidden="true" /> Templates
        </p>
        <h1>Start with a proven agent</h1>
        <p className="ztpl-subtitle">
          Choose a template, customize it, and launch with safety controls already configured.
        </p>
        <div className="ztpl-hero-actions">
          <label className="ztemplates-search" htmlFor="ztpl-search">
            <Search className="h-4 w-4" aria-hidden="true" />
            <input
              id="ztpl-search"
              type="search"
              className="ds-input ztemplates-search-input"
              placeholder="Search name, category, tags, or use cases"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <Link href="/agents/create" className="ds-btn ds-btn-secondary">
            Create from scratch
          </Link>
        </div>
      </header>

      <div className="ztemplates-filters" role="tablist" aria-label="Template categories">
        {TEMPLATE_FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            className={`ztemplates-filter-btn ${category === filter.id ? "is-active" : ""}`}
            onClick={() => setCategory(filter.id)}
          >
            {filter.label}
            <span className="ztpl-count">{counts[filter.id] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="ztpl-filter-row">
        <label>
          Risk
          <select
            className="ds-input"
            value={risk}
            onChange={(event) => setRisk(event.target.value as "all" | TemplateRiskLevel)}
          >
            {RISK_FILTERS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ztpl-check">
          <input
            type="checkbox"
            checked={requiresApproval}
            onChange={(event) => setRequiresApproval(event.target.checked)}
          />
          Requires approval
        </label>
        <label>
          Tool / integration
          <input
            className="ds-input"
            value={toolFilter}
            onChange={(event) => setToolFilter(event.target.value)}
            placeholder="email, CRM, calendar…"
          />
        </label>
        {filtersActive ? (
          <button type="button" className="ds-btn ds-btn-ghost" onClick={clearFilters}>
            Clear filters
          </button>
        ) : null}
      </div>

      {loading ? (
        <p className="ztemplates-loading" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading templates…
        </p>
      ) : null}

      {!loading && visibleTemplates.length === 0 ? (
        <div className="ztemplates-empty ds-panel">
          <p>No templates match your search.</p>
          <button type="button" className="ds-btn ds-btn-secondary" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      ) : null}

      <ul className="ztemplates-grid">
        {visibleTemplates.map((template) => {
          const Icon = getTemplateIcon(template.icon);
          const riskLevel = template.riskLevel ?? "medium";
          const categoryLabel =
            template.category in MARKETPLACE_CATEGORY_LABELS
              ? MARKETPLACE_CATEGORY_LABELS[template.category as MarketplaceCategory]
              : template.category;
          return (
            <li key={template.id}>
              <article className="ztemplates-card ds-panel">
                <span className="ztemplates-card-icon" aria-hidden="true">
                  <Icon className="h-5 w-5" />
                </span>
                <h2 className="ztemplates-card-title">{template.name}</h2>
                <p className="ztemplates-card-tagline">
                  {template.shortDescription ?? template.description}
                </p>
                <div className="ztpl-card-meta">
                  <span>{categoryLabel}</span>
                  <span className={`ztpl-risk ztpl-risk-${riskLevel}`}>{riskLevel}</span>
                  <span>~{template.estimatedSetupMinutes ?? 10} min</span>
                </div>
                <div className="ztemplates-tools">
                  {(template.suggestedIntegrations ?? template.tools).slice(0, 3).map((tool) => (
                    <span key={tool} className="ztemplates-tool-pill">
                      {tool}
                    </span>
                  ))}
                </div>
                <p className="ztpl-protected">
                  <Shield className="h-3.5 w-3.5" aria-hidden="true" /> Protected by {COMPANY_NAME}
                </p>
                <div className="ztpl-card-actions">
                  <button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={() => setPreview(template)}>
                    Preview
                  </button>
                  {template.slug === "travel-companion" || template.slug === "wedding-celebration-planner" || template.slug === "group-decision-planner" ? (
                    <button
                      type="button"
                      className="ds-btn ds-btn-secondary ds-btn-sm"
                      onClick={() => setPreview(template)}
                    >
                      Try Example
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ztemplates-use-btn"
                    disabled={submitting}
                    onClick={() => setPreview(template)}
                  >
                    Use template
                  </button>
                </div>
              </article>
            </li>
          );
        })}
      </ul>

      <TemplatePreviewModal
        template={preview}
        open={preview !== null && customize === null}
        onClose={() => {
          if (submitting) return;
          setPreview(null);
          setModalError(null);
        }}
        onUse={() => {
          if (preview) applyTemplateDefaults(preview);
        }}
        onCustomize={() => {
          if (preview) {
            setCustomize(preview);
          }
        }}
      />

      <TemplateCustomizeModal
        template={customize}
        open={customize !== null}
        submitting={submitting}
        error={modalError}
        onClose={() => {
          if (submitting) return;
          setCustomize(null);
        }}
        onSubmit={(values) => {
          if (customize) void handleCreateFromTemplate(customize, values);
        }}
      />
    </PageShell>
  );
}
