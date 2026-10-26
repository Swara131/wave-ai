export type ExpressionMatch = "match" | "no" | "missing";

function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim();
}

function isBlank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string" && !value.trim()) return true;
  return false;
}

function asBoolean(value: unknown): boolean | null {
  if (isBlank(value)) return null;
  if (typeof value === "boolean") return value;
  const text = asString(value).toLowerCase();
  if (["true", "yes", "y", "1"].includes(text)) return true;
  if (["false", "no", "n", "0"].includes(text)) return false;
  return null;
}

function asNumber(value: unknown): number | null {
  if (isBlank(value)) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = asString(value).replace(/[,₹$]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function readField(input: Record<string, unknown>, field: string): unknown {
  const key = field.trim();
  if (key in input) return input[key];
  const snake = key.replace(/\s+/g, "_");
  if (snake in input) return input[snake];
  return undefined;
}

function compare(
  left: unknown,
  op: string,
  rightRaw: string,
  threshold: number
): ExpressionMatch {
  const rightToken = rightRaw.trim().replace(/^["']|["']$/g, "");
  const rightValue = /^threshold$/i.test(rightToken) ? threshold : rightToken;

  if (op === "contains") {
    if (isBlank(left)) return "missing";
    return asString(left).toLowerCase().includes(asString(rightValue).toLowerCase())
      ? "match"
      : "no";
  }

  const leftNum = asNumber(left);
  const rightNum = asNumber(rightValue);
  if (leftNum != null && rightNum != null) {
    switch (op) {
      case "<=":
        return leftNum <= rightNum ? "match" : "no";
      case ">=":
        return leftNum >= rightNum ? "match" : "no";
      case "<":
        return leftNum < rightNum ? "match" : "no";
      case ">":
        return leftNum > rightNum ? "match" : "no";
      case "!=":
        return leftNum !== rightNum ? "match" : "no";
      default:
        return leftNum === rightNum ? "match" : "no";
    }
  }

  const leftBool = asBoolean(left);
  const rightBool = asBoolean(rightValue);
  if (leftBool != null && rightBool != null) {
    return (op === "!=" ? leftBool !== rightBool : leftBool === rightBool) ? "match" : "no";
  }

  if (isBlank(left)) return "missing";
  const leftText = asString(left).toLowerCase();
  const rightText = asString(rightValue).toLowerCase();
  if (op === "!=") return leftText !== rightText ? "match" : "no";
  return leftText === rightText ? "match" : "no";
}

function evaluateAtom(
  atom: string,
  input: Record<string, unknown>,
  threshold: number
): ExpressionMatch {
  const trimmed = atom.trim();
  if (!trimmed) return "missing";
  if (/^otherwise$/i.test(trimmed)) return "match";

  const contains = trimmed.match(/^(.+?)\s+contains\s+(.+)$/i);
  if (contains) {
    return compare(readField(input, contains[1] ?? ""), "contains", contains[2] ?? "", threshold);
  }

  const comparison = trimmed.match(/^(.+?)\s*(<=|>=|!=|==|=|<|>)\s*(.+)$/);
  if (comparison) {
    return compare(
      readField(input, comparison[1] ?? ""),
      comparison[2] ?? "=",
      comparison[3] ?? "",
      threshold
    );
  }

  const value = readField(input, trimmed);
  if (isBlank(value)) return "missing";
  const bool = asBoolean(value);
  if (bool != null) return bool ? "match" : "no";
  return "match";
}

function combineAnd(parts: ExpressionMatch[]): ExpressionMatch {
  if (parts.includes("missing")) return "missing";
  if (parts.includes("no")) return "no";
  return "match";
}

function combineOr(parts: ExpressionMatch[]): ExpressionMatch {
  if (parts.includes("match")) return "match";
  if (parts.every((part) => part === "missing")) return "missing";
  if (parts.includes("missing")) return "missing";
  return "no";
}

export function evaluateExpression(
  expression: string,
  input: Record<string, unknown>,
  options?: { threshold?: number }
): ExpressionMatch {
  const threshold = options?.threshold ?? 5000;
  const trimmed = expression.trim();
  if (!trimmed) return "missing";
  if (/^otherwise$/i.test(trimmed)) return "match";

  const orParts = trimmed.split(/\s+OR\s+/i).map((part) => {
    const andParts = part.split(/\s+AND\s+/i).map((atom) => evaluateAtom(atom, input, threshold));
    return combineAnd(andParts);
  });
  return combineOr(orParts);
}
