import { groqJsonCompletion } from "@/lib/groq/client";
import { isGroqConfigured } from "@/lib/groq/env";
import { parseJsonText } from "@/lib/groq/json";
import { handleFetchUrl } from "@/lib/agents/tools/handlers/fetch-url";
import { handleWebSearch, isWebSearchConfigured } from "@/lib/agents/tools/handlers/web-search";
import { classifySourceUrl, executionAgentsFromConfig } from "./execution-agents";
import type { DecisionAgentConfig } from "./types";
import type {
  DecisionAgentFinding,
  DecisionRunReport,
  DecisionRunSource,
  ExecutionAgentSpec,
} from "./run-types";

export interface SearchHit {
  title: string;
  url: string;
  description: string;
}

export interface RunExecutionDeps {
  search: (
    query: string
  ) => Promise<{ results: SearchHit[]; answer?: string; error?: string }>;
  fetchUrl: (url: string) => Promise<{ title: string; text: string; error?: string }>;
  completeJson?: (system: string, prompt: string) => Promise<unknown>;
  now: () => Date;
  searchConfigured: boolean;
  groqConfigured: boolean;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function emptyFinding(spec: ExecutionAgentSpec): DecisionAgentFinding {
  return {
    id: spec.id,
    name: spec.name,
    role: spec.role,
    status: "pending",
    summary: "",
    evidence: [],
    sources: [],
    dates: [],
    assumptions: [],
    uncertainties: [],
    verifiedFacts: [],
    estimates: [],
    unknowns: [],
    risks: [],
    counterarguments: [],
    conflicts: [],
    missingInformation: [],
    error: null,
    startedAt: null,
    finishedAt: null,
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function defaultRunDeps(): RunExecutionDeps {
  return {
    searchConfigured: isWebSearchConfigured(),
    groqConfigured: isGroqConfigured(),
    now: () => new Date(),
    search: async (query) => {
      const result = await handleWebSearch({ query, count: 6 });
      if (!result.executed) {
        return { results: [], error: result.error ?? "Search failed." };
      }
      const results = Array.isArray(result.output.results)
        ? (result.output.results as SearchHit[]).filter((item) => item.url)
        : [];
      const answer = typeof result.output.answer === "string" ? result.output.answer : undefined;
      return { results, answer };
    },
    fetchUrl: async (url) => {
      const result = await handleFetchUrl({ url });
      if (!result.executed) {
        return { title: url, text: "", error: result.error ?? "Could not fetch URL." };
      }
      return {
        title: typeof result.output.title === "string" ? result.output.title : url,
        text: typeof result.output.text === "string" ? result.output.text : "",
      };
    },
    completeJson: async (system, prompt) => {
      const raw = await groqJsonCompletion(prompt, { system, kind: "risk", temperature: 0 });
      return parseJsonText(raw);
    },
  };
}

function toSources(hits: SearchHit[], retrievedAt: string): DecisionRunSource[] {
  return hits
    .filter((hit) => hit.url)
    .map((hit) => ({
      title: hit.title || hostname(hit.url) || "Source",
      url: hit.url,
      name: hostname(hit.url) || hit.title || "Source",
      snippet: hit.description?.slice(0, 400) ?? "",
      kind: classifySourceUrl(hit.url),
      publicationDate: null,
      retrievedAt,
    }));
}

function pickOfficialUrls(sources: DecisionRunSource[]): string[] {
  return sources
    .filter((item) => item.kind === "official" || item.kind === "exchange" || item.kind === "company")
    .map((item) => item.url)
    .slice(0, 3);
}

async function analyzeWithModel(
  deps: RunExecutionDeps,
  spec: ExecutionAgentSpec,
  input: Record<string, unknown>,
  purpose: string,
  sources: DecisionRunSource[],
  extracts: Array<{ url: string; title: string; text: string }>,
  searchAnswer: string | undefined
): Promise<Partial<DecisionAgentFinding> & { ipoStatus?: string | null; financials?: string | null }> {
  if (!deps.groqConfigured || !deps.completeJson) {
    return {
      summary:
        "AI analysis is unavailable (GROQ_API_KEY is not configured). Retrieved sources are listed without interpreting figures or IPO dates.",
      unknowns: ["Model analysis was not run."],
      missingInformation: ["GROQ_API_KEY"],
      error: "GROQ_API_KEY is not configured.",
    };
  }

  const allowedUrls = sources.map((item) => item.url);
  const system = [
    "You are Wave, a research assistant for Indian capital-markets questions.",
    "Use ONLY the retrieved source snippets and extracts provided.",
    "Never invent URLs, dates, subscription figures, valuation numbers, or listing status.",
    "If a fact is not explicitly supported by a provided snippet, put it in unknowns.",
    "Never recommend applying to an IPO or guarantee returns.",
    "Return JSON only.",
  ].join(" ");

  const prompt = JSON.stringify({
    agent: spec,
    purpose,
    operatorInput: input,
    searchAnswer: searchAnswer ?? null,
    sources,
    extracts: extracts.map((item) => ({
      url: item.url,
      title: item.title,
      text: item.text.slice(0, 4000),
    })),
    schema: {
      summary: "string",
      verifiedFacts: "string[] only if directly supported",
      estimates: "string[]",
      assumptions: "string[]",
      unknowns: "string[]",
      risks: "string[]",
      counterarguments: "string[]",
      conflicts: "string[]",
      missingInformation: "string[]",
      dates: "string[] only dates present in sources",
      ipoStatus: "string|null only if an official/exchange source states status",
      financials: "string|null only if figures appear in sources",
      evidenceQuality: "high|medium|low|insufficient",
      usedSourceUrls: "subset of provided urls",
    },
  });

  const parsed = await deps.completeJson(system, prompt);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Model returned an unusable analysis.");
  }
  const row = parsed as Record<string, unknown>;
  const used = asStringArray(row.usedSourceUrls).filter((url) => allowedUrls.includes(url));
  const quality =
    row.evidenceQuality === "high" ||
    row.evidenceQuality === "medium" ||
    row.evidenceQuality === "low" ||
    row.evidenceQuality === "insufficient"
      ? row.evidenceQuality
      : "insufficient";

  return {
    summary: typeof row.summary === "string" ? row.summary.trim() : "",
    verifiedFacts: asStringArray(row.verifiedFacts),
    estimates: asStringArray(row.estimates),
    assumptions: asStringArray(row.assumptions),
    unknowns: asStringArray(row.unknowns),
    risks: asStringArray(row.risks),
    counterarguments: asStringArray(row.counterarguments),
    conflicts: asStringArray(row.conflicts),
    missingInformation: asStringArray(row.missingInformation),
    dates: asStringArray(row.dates),
    evidence: used.length ? used : allowedUrls.slice(0, 5),
    ipoStatus: typeof row.ipoStatus === "string" && row.ipoStatus.trim() ? row.ipoStatus.trim() : null,
    financials: typeof row.financials === "string" && row.financials.trim() ? row.financials.trim() : null,
    uncertainties: quality === "insufficient" ? ["Insufficient verified information in retrieved sources."] : [],
  };
}

export function combineFindings(
  title: string,
  executedAt: string,
  findings: DecisionAgentFinding[],
  ipoStatus: string | null,
  financials: string | null
): DecisionRunReport {
  const completed = findings.filter((item) => item.status === "completed");
  const failed = findings.filter((item) => item.status === "failed" || item.status === "unable_to_verify");
  const officialHits = findings.flatMap((item) =>
    item.sources.filter((source) => source.kind === "official" || source.kind === "exchange")
  );
  const insufficient =
    completed.length === 0 ||
    officialHits.length === 0 ||
    findings.every((item) => item.verifiedFacts.length === 0);

  const overall: DecisionRunReport["overall"] = insufficient
    ? "insufficient"
    : findings.some((item) => item.id === "recommend_action" && /apply/i.test(item.summary))
      ? "review"
      : "review";

  const explanation = insufficient
    ? "Insufficient verified information. Wave did not treat media commentary as an official IPO status, and will not recommend applying."
    : "Findings were combined after each agent finished. Block/review defaults apply: Wave will not auto-recommend applying or guarantee listing gains.";

  return {
    title,
    executedAt,
    overall,
    overallExplanation: explanation,
    evidenceQuality: insufficient ? "insufficient" : officialHits.length >= 2 ? "medium" : "low",
    ipoStatus: insufficient ? null : ipoStatus,
    ipoStatusVerified: Boolean(ipoStatus && officialHits.length > 0 && !insufficient),
    financialAnalysis: insufficient ? null : financials,
    nextSteps: [
      "Read primary SEBI / exchange / company documents yourself.",
      "Do not treat this report as an application instruction or a return guarantee.",
      failed.length
        ? `${failed.length} agent(s) did not fully complete — treat those sections as incomplete.`
        : "Review uncertainties and missing information in each agent section.",
    ],
    agents: findings,
    insufficientVerifiedInformation: insufficient,
  };
}

export async function executeDecisionRun(params: {
  title: string;
  purpose: string;
  config: DecisionAgentConfig;
  input: Record<string, unknown>;
  deps?: RunExecutionDeps;
  onProgress?: (findings: DecisionAgentFinding[]) => Promise<void> | void;
}): Promise<DecisionRunReport> {
  const deps = params.deps ?? defaultRunDeps();
  const nowIso = () => deps.now().toISOString();
  const specs = executionAgentsFromConfig(params.config, params.purpose, params.input);
  const findings = specs.map((spec) => emptyFinding(spec));
  await params.onProgress?.(findings);

  let sharedHits: SearchHit[] = [];
  let sharedAnswer: string | undefined;
  let sharedError: string | undefined;

  if (!deps.searchConfigured) {
    sharedError =
      "Web search is not configured. Set TAVILY_API_KEY or BRAVE_SEARCH_API_KEY, then retry.";
  } else {
    const topicQuery = /\bjio\b/i.test(params.purpose)
      ? "Jio Platforms IPO SEBI DRHP official filing NSE BSE Reliance"
      : `${params.purpose} official filing`;
    const shared = await deps.search(topicQuery);
    sharedHits = shared.results;
    sharedAnswer = shared.answer;
    sharedError = shared.error;
  }

  let ipoStatus: string | null = null;
  let financials: string | null = null;

  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index];
    findings[index] = {
      ...findings[index],
      status: "running",
      startedAt: nowIso(),
      finishedAt: null,
    };
    await params.onProgress?.(findings);

    try {
      let hits = sharedHits;
      let answer = sharedAnswer;
      let searchError = sharedError;

      if (deps.searchConfigured) {
        const extra = await deps.search(spec.searchQuery);
        if (extra.results.length) {
          const seen = new Set(hits.map((item) => item.url));
          hits = [...hits, ...extra.results.filter((item) => item.url && !seen.has(item.url))];
        }
        if (!answer) answer = extra.answer;
        if (!hits.length && extra.error) searchError = extra.error;
      }

      if (!hits.length) {
        findings[index] = {
          ...findings[index],
          status: "unable_to_verify",
          summary: searchError
            ? `Unable to verify: ${searchError}`
            : "Unable to verify: no retrievable sources were returned for this agent.",
          error: searchError ?? "No sources returned.",
          unknowns: ["No retrieved sources."],
          missingInformation: ["Primary filings were not retrieved."],
          finishedAt: nowIso(),
        };
        await params.onProgress?.(findings);
        continue;
      }

      const sources = toSources(hits, nowIso());
      const extracts: Array<{ url: string; title: string; text: string }> = [];
      for (const url of pickOfficialUrls(sources)) {
        const fetched = await deps.fetchUrl(url);
        if (!fetched.error && fetched.text.trim()) {
          extracts.push({ url, title: fetched.title, text: fetched.text });
        }
      }

      const analyzed = await analyzeWithModel(
        deps,
        spec,
        params.input,
        params.purpose,
        sources,
        extracts,
        answer
      );

      if (analyzed.ipoStatus && !ipoStatus) ipoStatus = analyzed.ipoStatus;
      if (analyzed.financials && !financials) financials = analyzed.financials;

      const groqBlocked = Boolean(analyzed.error?.includes("GROQ_API_KEY"));
      findings[index] = {
        ...findings[index],
        status: groqBlocked ? "unable_to_verify" : "completed",
        summary: analyzed.summary || "Retrieved sources are listed. No additional model summary was produced.",
        evidence: analyzed.evidence ?? sources.map((item) => item.url),
        sources,
        dates: analyzed.dates ?? [],
        assumptions: analyzed.assumptions ?? [],
        uncertainties: analyzed.uncertainties ?? [],
        verifiedFacts: analyzed.verifiedFacts ?? [],
        estimates: analyzed.estimates ?? [],
        unknowns: analyzed.unknowns ?? [],
        risks: analyzed.risks ?? [],
        counterarguments: analyzed.counterarguments ?? [],
        conflicts: analyzed.conflicts ?? [],
        missingInformation: analyzed.missingInformation ?? [],
        error: groqBlocked ? analyzed.error ?? null : null,
        finishedAt: nowIso(),
      };
    } catch (err) {
      findings[index] = {
        ...findings[index],
        status: "failed",
        summary: "This agent failed before a verified finding could be written.",
        error: err instanceof Error ? err.message : "Agent execution failed.",
        finishedAt: nowIso(),
      };
    }
    await params.onProgress?.(findings);
  }

  const officialStatus =
    ipoStatus &&
    findings.some((item) =>
      item.sources.some((source) => source.kind === "official" || source.kind === "exchange")
    )
      ? ipoStatus
      : null;

  return combineFindings(params.title, nowIso(), findings, officialStatus, financials);
}
