export type QlooSourceKind = "qloo" | "fallback";

export type QlooErrorKind =
  | "missing_key"
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "empty"
  | "timeout";

export interface QlooTag {
  tagId: string;
  name: string;
  subtype?: string;
}

export interface QlooEntity {
  entityId: string;
  name: string;
  subtype?: string;
  popularity?: number;
  address?: string;
  neighborhood?: string;
  affinity?: number;
  tags?: string[];
}

export interface QlooTasteResult {
  source: QlooSourceKind;
  queriedAt: string;
  endpoint: string;
  tags: QlooTag[];
  entities: QlooEntity[];
  errorKind?: QlooErrorKind;
  error?: string;
  usedSignals: string[];
}
