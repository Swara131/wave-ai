import type { DecisionAgentConfig } from "./types";
import type { ExecutionAgentSpec, SourceKind } from "./run-types";

export function classifySourceUrl(url: string): SourceKind {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "unknown";
  }
  if (!host) return "unknown";
  if (host.endsWith("sebi.gov.in") || host.includes("sebi.gov")) return "official";
  if (host.includes("nseindia") || host.includes("bseindia")) return "exchange";
  if (host.includes("ril.com") || host.includes("riil.com") || host.includes("jio.com") || host.includes("reliance")) {
    return "company";
  }
  return "media";
}

export function sourceKindLabel(kind: SourceKind): string {
  if (kind === "official") return "Official / regulator";
  if (kind === "exchange") return "Exchange";
  if (kind === "company") return "Company disclosure";
  if (kind === "media") return "Media / commentary";
  return "Unclassified";
}

function isPlaceholderTitle(title: string): boolean {
  const value = title.trim().toLowerCase();
  return (
    value === "new decision" ||
    value === "new input" ||
    value === "combine" ||
    value === "output" ||
    value === "live result"
  );
}

function topicFromPurpose(purpose: string): string {
  if (/\bjio\b/i.test(purpose) && /\bipo\b/i.test(purpose)) {
    return "Jio Platforms IPO";
  }
  if (/\bipo\b/i.test(purpose)) return "the stated IPO";
  return "the stated opportunity";
}

function queryForUnit(title: string, purpose: string, input: Record<string, unknown>): string {
  const topic = topicFromPurpose(purpose);
  const claim = typeof input.claim_summary === "string" ? input.claim_summary : "";
  const lowered = title.toLowerCase();
  if (lowered.includes("source") || lowered.includes("verified")) {
    return `${topic} SEBI DRHP filing official announcement site:sebi.gov.in OR NSE OR BSE OR Reliance`;
  }
  if (lowered.includes("risk")) {
    return `${topic} risks SEBI observations retail investor disclosure`;
  }
  if (lowered.includes("recommend") || lowered.includes("apply") || lowered.includes("acting")) {
    return `${topic} current status listing date application window official`;
  }
  return `${topic} official filing ${title} ${claim}`.trim();
}

export function executionAgentsFromConfig(
  config: DecisionAgentConfig,
  purpose: string,
  input: Record<string, unknown>
): ExecutionAgentSpec[] {
  const fromConfig = (config.decisions ?? []).filter((unit) => !isPlaceholderTitle(unit.title));
  const units =
    fromConfig.length > 0
      ? fromConfig
      : [
          {
            id: "source_quality",
            title: "Are the facts from verified sources?",
            description: "Official filings beat rumors.",
            inputs: [],
            rules: [],
          },
          {
            id: "risk_stance",
            title: `What risk stance fits this person for ${topicFromPurpose(purpose)}?`,
            description: "Uses only the profile they gave plus retrieved disclosures.",
            inputs: [],
            rules: [],
          },
          {
            id: "recommend_action",
            title: "Should Wave recommend applying or acting now?",
            description: "Never blindly recommend applying.",
            inputs: [],
            rules: [],
          },
        ];

  return units.map((unit) => ({
    id: unit.id,
    name: unit.title,
    role: unit.description,
    searchQuery: queryForUnit(unit.title, purpose, input),
  }));
}
