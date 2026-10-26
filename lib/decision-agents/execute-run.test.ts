import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executionAgentsFromConfig } from "./execution-agents";
import { classifySourceUrl } from "./execution-agents";
import { combineFindings, executeDecisionRun, type RunExecutionDeps } from "./execute-run";
import { generateDecisionAgentFromPrompt } from "./generate-from-prompt";
import type { DecisionAgentFinding } from "./run-types";

function stubFinding(partial: Partial<DecisionAgentFinding>): DecisionAgentFinding {
  return {
    id: "source_quality",
    name: "Sources",
    role: "verify",
    status: "completed",
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
    ...partial,
  };
}

describe("executionAgentsFromConfig", () => {
  it("keeps generated IPO agents and drops untitled New decision boxes", () => {
    const preview = generateDecisionAgentFromPrompt({
      prompt:
        'Build a multi-agent AI assistant called "Jio IPO Research & Decision Assistant" using verified information without blindly recommending that users apply.',
    });
    preview.config.decisions = [
      ...(preview.config.decisions ?? []),
      {
        id: "decision-extra",
        title: "New decision",
        description: "placeholder",
        inputs: [],
        rules: [],
      },
    ];
    const agents = executionAgentsFromConfig(preview.config, preview.purpose, {
      claim_summary: "Should I apply?",
    });
    assert.ok(agents.length >= 3);
    assert.ok(!agents.some((item) => item.name === "New decision"));
    assert.ok(agents.some((item) => item.id === "source_quality"));
  });
});

describe("classifySourceUrl", () => {
  it("marks SEBI and exchanges as official-class sources", () => {
    assert.equal(classifySourceUrl("https://www.sebi.gov.in/filings/drhp.html"), "official");
    assert.equal(classifySourceUrl("https://www.nseindia.com/companies-listing"), "exchange");
    assert.equal(classifySourceUrl("https://example-news.com/rumour"), "media");
  });
});

describe("combineFindings", () => {
  it("does not invent verified IPO status when sources are missing", () => {
    const report = combineFindings(
      "Jio IPO Research & Decision Assistant",
      "2026-10-23T10:00:00.000Z",
      [
        stubFinding({
          status: "unable_to_verify",
          summary: "No sources",
        }),
      ],
      "Open for subscription",
      "₹1,00,000 crore"
    );
    assert.equal(report.insufficientVerifiedInformation, true);
    assert.equal(report.ipoStatusVerified, false);
    assert.equal(report.ipoStatus, null);
    assert.equal(report.financialAnalysis, null);
    assert.equal(report.overall, "insufficient");
  });

  it("keeps partial results when one agent fails", () => {
    const report = combineFindings(
      "Jio IPO Research & Decision Assistant",
      "2026-10-23T10:00:00.000Z",
      [
        stubFinding({
          id: "source_quality",
          status: "completed",
          verifiedFacts: ["SEBI hosts a filing index."],
          sources: [
            {
              title: "SEBI",
              url: "https://www.sebi.gov.in/example",
              name: "sebi.gov.in",
              snippet: "Filings",
              kind: "official",
              publicationDate: null,
              retrievedAt: "2026-10-23T10:00:00.000Z",
            },
          ],
        }),
        stubFinding({
          id: "risk_stance",
          name: "Risk",
          status: "failed",
          error: "Model timed out",
        }),
      ],
      null,
      null
    );
    assert.equal(report.agents.length, 2);
    assert.equal(report.agents[1]?.status, "failed");
    assert.match(report.nextSteps.join(" "), /1 agent/);
  });
});

describe("executeDecisionRun", () => {
  it("records retrieved sources and does not fabricate figures", async () => {
    const preview = generateDecisionAgentFromPrompt({
      prompt: "Help investors understand a Jio IPO using official filings. Do not blindly recommend applying.",
    });
    const deps: RunExecutionDeps = {
      searchConfigured: true,
      groqConfigured: true,
      now: () => new Date("2026-10-23T10:00:00.000Z"),
      search: async () => ({
        results: [
          {
            title: "SEBI filing portal",
            url: "https://www.sebi.gov.in/filings.html",
            description: "List of offer documents hosted by SEBI.",
          },
        ],
      }),
      fetchUrl: async (url) => ({ title: "SEBI", text: "Offer documents are published on this portal.", url }),
      completeJson: async () => ({
        summary: "SEBI hosts offer documents. No subscription window is stated in the retrieved snippet.",
        verifiedFacts: ["SEBI publishes offer documents on its website."],
        estimates: [],
        assumptions: [],
        unknowns: ["Whether a Jio Platforms IPO is currently open."],
        risks: ["Acting on incomplete official status."],
        counterarguments: [],
        conflicts: [],
        missingInformation: ["No retrieved snippet states an open/close date."],
        dates: [],
        ipoStatus: null,
        financials: null,
        evidenceQuality: "low",
        usedSourceUrls: ["https://www.sebi.gov.in/filings.html"],
      }),
    };

    const report = await executeDecisionRun({
      title: preview.name,
      purpose: preview.purpose,
      config: preview.config,
      input: { claim_summary: "Should a retail investor apply?" },
      deps,
    });

    assert.equal(report.title, preview.name);
    assert.ok(report.agents.length >= 3);
    assert.ok(!report.agents.some((item) => item.name === "New decision"));
    assert.equal(report.ipoStatusVerified, false);
    assert.equal(report.financialAnalysis, null);
    assert.ok(report.agents[0]?.sources.some((item) => item.url.includes("sebi.gov.in")));
  });

  it("marks agents unable to verify when search is missing", async () => {
    const preview = generateDecisionAgentFromPrompt({
      prompt: "Help investors understand a Jio IPO using official filings.",
    });
    const report = await executeDecisionRun({
      title: preview.name,
      purpose: preview.purpose,
      config: preview.config,
      input: {},
      deps: {
        searchConfigured: false,
        groqConfigured: false,
        now: () => new Date("2026-10-23T10:00:00.000Z"),
        search: async () => ({ results: [], error: "not configured" }),
        fetchUrl: async () => ({ title: "", text: "", error: "skip" }),
      },
    });
    assert.ok(report.agents.every((item) => item.status === "unable_to_verify"));
    assert.equal(report.insufficientVerifiedInformation, true);
  });

  it("keeps other agents when one search path fails after a successful shared hit", async () => {
    const preview = generateDecisionAgentFromPrompt({
      prompt: "Help investors understand a Jio IPO using official filings.",
    });
    let calls = 0;
    const report = await executeDecisionRun({
      title: preview.name,
      purpose: preview.purpose,
      config: preview.config,
      input: {},
      deps: {
        searchConfigured: true,
        groqConfigured: true,
        now: () => new Date("2026-10-23T10:00:00.000Z"),
        search: async () => {
          calls += 1;
          if (calls === 1) {
            return {
              results: [
                {
                  title: "NSE",
                  url: "https://www.nseindia.com/ipo",
                  description: "IPO section exists on NSE.",
                },
              ],
            };
          }
          if (calls === 3) return { results: [], error: "rate limited" };
          return { results: [] };
        },
        fetchUrl: async () => ({ title: "NSE", text: "IPO information hub." }),
        completeJson: async () => ({
          summary: "NSE has an IPO section. No Jio window is quoted here.",
          verifiedFacts: ["NSE publishes an IPO information section."],
          estimates: [],
          assumptions: [],
          unknowns: ["Jio Platforms IPO open status"],
          risks: [],
          counterarguments: [],
          conflicts: [],
          missingInformation: [],
          dates: [],
          ipoStatus: null,
          financials: null,
          evidenceQuality: "low",
          usedSourceUrls: ["https://www.nseindia.com/ipo"],
        }),
      },
    });
    assert.ok(report.agents.some((item) => item.status === "completed"));
    assert.ok(report.agents.length >= 3);
  });
});
