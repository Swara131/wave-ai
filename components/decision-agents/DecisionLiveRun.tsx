"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { fieldsForConfig, parseInputValue } from "@/lib/decision-agents/input-labels";
import type { DecisionAgentConfig } from "@/lib/decision-agents/types";

export default function DecisionLiveRun({
  config,
  title,
  purpose,
  backHref = "/decision-agents/create",
}: {
  config: DecisionAgentConfig;
  title: string;
  purpose: string;
  slug?: string | null;
  backHref?: string;
}) {
  const router = useRouter();
  const fields = useMemo(() => fieldsForConfig(config), [config]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const inFlight = useRef(false);

  const missingRequired = fields.filter((field) => field.required && !(values[field.key] ?? "").trim());

  const run = async () => {
    if (inFlight.current || running) return;
    if (missingRequired.length) {
      setError(`Enter real values for: ${missingRequired.map((item) => item.label).join(", ")}.`);
      return;
    }
    inFlight.current = true;
    setRunning(true);
    setError(null);

    const input: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = (values[field.key] ?? "").trim();
      if (!raw) continue;
      input[field.key] = parseInputValue(field.key, raw, field.type);
    }

    try {
      const response = await fetch("/api/v1/decision-agents/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          purpose,
          config,
          input,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const payload = (await response.json()) as { runId?: string; error?: string };
      if (!response.ok || !payload.runId) {
        throw new Error(payload.error ?? "Could not start the research run.");
      }
      router.push(
        `/decision-agents/results/${encodeURIComponent(payload.runId)}?from=${encodeURIComponent(backHref)}`
      );
    } catch (err) {
      idempotencyKey.current = crypto.randomUUID();
      setError(err instanceof Error ? err.message : "Could not start the research run.");
      setRunning(false);
      inFlight.current = false;
    }
  };

  return (
    <section className="zdec-live">
      <div className="zdec-live-case zdec-live-case-wide">
        <h3>Case facts</h3>
        <p>Type real information. Empty fields stay unknown — Wave will not fill them in.</p>
        {fields.map((field) => (
          <label key={field.key} className="zdec-field">
            <span>
              {field.label}
              {field.required ? " *" : ""}
            </span>
            <small>{field.description}</small>
            {field.type === "boolean" || field.type === "choice" ? (
              <select
                className="ds-input"
                value={values[field.key] ?? ""}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))
                }
              >
                <option value="">Select…</option>
                {(field.options ?? [
                  { id: "true", label: "Yes" },
                  { id: "false", label: "No" },
                ]).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === "textarea" ? (
              <textarea
                className="ds-input"
                rows={3}
                value={values[field.key] ?? ""}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
            ) : (
              <input
                className="ds-input"
                type="text"
                inputMode={field.type === "number" ? "decimal" : "text"}
                value={values[field.key] ?? ""}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
            )}
          </label>
        ))}
        <button type="button" className="studio-primary" disabled={running} onClick={() => void run()}>
          {running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Starting research run…
            </>
          ) : (
            "Run decisions live"
          )}
        </button>
        {error ? (
          <p className="zplat-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
