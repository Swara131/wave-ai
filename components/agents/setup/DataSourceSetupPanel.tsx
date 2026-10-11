"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import type { AgentDataSourceConfig, AgentDataSourceKind } from "@/lib/agents/data-source/types";
import { MAX_CSV_BYTES } from "@/lib/agents/data-source/types";
import {
  mappingToRecord,
  reconcileFieldMapping,
} from "@/lib/agents/data-source/mapping";
import type { EvidenceFieldSpec } from "@/lib/agents/runtime/analysis/record-validation";

interface DataSourcePayload {
  success?: boolean;
  config?: AgentDataSourceConfig | null;
  capabilities?: { waveDatabaseConfigured: boolean };
  evidenceFields?: EvidenceFieldSpec[];
  suggestedMapping?: { sourceColumn: string; targetField: string }[];
  preview?: { headers: string[]; rowCount: number; sampleRows: Record<string, unknown>[] } | null;
  error?: string;
  empty?: boolean;
  verified?: boolean;
}

const KINDS: Array<{ id: AgentDataSourceKind; label: string; hint: string }> = [
  { id: "csv_upload", label: "CSV upload", hint: "Your file is stored under your account and analyzed as-is." },
  { id: "wave_database", label: "Wave ticket table", hint: "Reads public.agent_crm_updates if that migration is applied." },
  { id: "manual_sample", label: "Sample / test rows", hint: "Labeled test data. Not treated as a live connection." },
];

const SAMPLE_CSV = `ticket_id,customer_id,customer_name,resolution_details,satisfaction_rating
TKT-1001,cus_ada,Ada Lovelace,Restarted the mailer and attached SMTP logs showing the timeout,5
TKT-1002,cus_grace,Grace Hopper,Replaced the failing disk and attached SMART evidence from the host,4`;

function downloadSampleCsv() {
  const blob = new Blob([SAMPLE_CSV], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "wave-ticket-evidence-sample.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function DataSourceSetupPanel({
  agentId,
  onStatusChange,
}: {
  agentId: string;
  onStatusChange?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<DataSourcePayload | null>(null);
  const [kind, setKind] = useState<AgentDataSourceKind>("csv_upload");
  const [sampleText, setSampleText] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/data-source`);
      const next = (await response.json()) as DataSourcePayload;
      if (!response.ok) throw new Error(next.error ?? "Could not load data source.");
      setPayload(next);
      const config = next.config;
      if (config?.kind === "google_sheets") {
        setKind("csv_upload");
        setError(next.error ?? "Google Sheets is no longer supported. Choose CSV upload or sample rows.");
      } else if (config) {
        setKind(config.kind);
        setSampleText(config.manual?.raw ?? "");
      }
      const headerList = next.preview?.headers?.length
        ? next.preview.headers
        : config?.headers ?? [];
      setMapping(
        mappingToRecord(
          reconcileFieldMapping(config?.mapping ?? [], next.suggestedMapping ?? [], headerList)
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load data source.");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const mappingList = Object.entries(mapping).map(([targetField, sourceColumn]) => ({
        targetField,
        sourceColumn,
      }));
      const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/data-source`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          mapping: mappingList,
          sampleText,
        }),
      });
      const next = (await response.json()) as DataSourcePayload;
      if (!response.ok || !next.success) {
        throw new Error(next.error ?? "Could not verify the data source.");
      }
      setPayload((current) => ({ ...current, ...next, verified: true }));
      await load();
      onStatusChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify the data source.");
    } finally {
      setSaving(false);
    }
  };

  const uploadCsv = async (file: File) => {
    if (file.size > MAX_CSV_BYTES) {
      setError("File exceeds the 2 MB agent-data limit.");
      return;
    }
    const name = file.name.toLowerCase();
    if (!name.endsWith(".csv") && !name.endsWith(".json") && !name.endsWith(".txt")) {
      setError("Choose a .csv, .json, or .txt file of ticket records.");
      return;
    }
    setLocalFile(file);
    setSaving(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentId)}/data-source/upload`, {
        method: "POST",
        body,
      });
      const next = (await response.json()) as DataSourcePayload & { headers?: string[]; rowCount?: number };
      if (!response.ok || !next.success) throw new Error(next.error ?? "Upload failed.");
      setKind("csv_upload");
      const headerList = next.headers ?? next.config?.headers ?? [];
      setMapping(
        mappingToRecord(
          reconcileFieldMapping([], next.config?.mapping ?? [], headerList)
        )
      );
      setPayload((current) => ({
        ...current,
        ...next,
        preview: {
          headers: next.headers ?? next.config?.headers ?? [],
          rowCount: next.rowCount ?? next.config?.rowCount ?? 0,
          sampleRows: current?.preview?.sampleRows ?? [],
        },
      }));
      await load();
      onStatusChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setSaving(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onDropCsv = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void uploadCsv(file);
  };

  if (loading) {
    return (
      <section className="prep-section">
        <p className="prep-loading">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading data source…
        </p>
      </section>
    );
  }

  const config = payload?.config ?? null;
  const fields = payload?.evidenceFields ?? [];
  const headers = payload?.preview?.headers?.length
    ? payload.preview.headers
    : config?.headers ?? [];
  const verified = Boolean(config?.verifiedAt) && config?.kind !== "google_sheets";
  const empty = payload?.preview?.rowCount === 0 || config?.rowCount === 0;

  return (
    <section className="prep-section ds-data-source">
      <header>
        <h2>Data source</h2>
        <p>
          Connect records this agent should analyze. Wave stores this on your agent only and never
          exposes service-role keys in the browser.
        </p>
      </header>

      {error ? (
        <p className="prep-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="ds-source-kinds">
        {KINDS.map((option) => (
            <label key={option.id}>
              <input
                type="radio"
                name="data-source-kind"
                checked={kind === option.id}
                disabled={saving}
                onChange={() => setKind(option.id)}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.hint}</small>
              </span>
            </label>
        ))}
      </div>

      {kind === "csv_upload" ? (
        <div className="ds-csv-upload">
          <input
            ref={fileInputRef}
            id="agent-csv-file"
            type="file"
            accept=".csv,.json,.txt,text/csv,application/json"
            disabled={saving}
            className="ds-csv-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadCsv(file);
            }}
          />
          <div
            className={`ds-csv-dropzone${dragging ? " is-dragging" : ""}${saving ? " is-busy" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              if (!saving) setDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragging(false);
            }}
            onDrop={onDropCsv}
          >
            <FileSpreadsheet className="ds-csv-icon" aria-hidden="true" />
            <p>
              <strong>Upload a CSV of ticket records</strong>
              Drop a file here, or choose one from your computer. Max 2 MB. CSV, JSON, or TXT.
            </p>
            <div className="ds-csv-actions">
              <button
                type="button"
                className="prep-btn prep-btn-primary"
                disabled={saving}
                onClick={() => fileInputRef.current?.click()}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" /> Choose CSV file
                  </>
                )}
              </button>
              <button type="button" className="prep-btn prep-btn-secondary" disabled={saving} onClick={downloadSampleCsv}>
                Download sample CSV
              </button>
            </div>
            {localFile || config?.csv?.filename ? (
              <p className="ds-csv-current">
                {localFile
                  ? `Selected: ${localFile.name} (${Math.max(1, Math.round(localFile.size / 1024))} KB)`
                  : `Current file: ${config?.csv?.filename}`}
                {payload?.preview?.rowCount != null ? ` · ${payload.preview.rowCount} rows parsed` : null}
              </p>
            ) : (
              <p className="ds-csv-current">No file chosen yet. Upload a file before Save and verify.</p>
            )}
          </div>
        </div>
      ) : null}

      {kind === "manual_sample" ? (
        <label className="prep-field">
          <span>Sample rows (CSV or JSON array) — labeled test data</span>
          <textarea
            className="ds-input"
            rows={8}
            value={sampleText}
            onChange={(event) => setSampleText(event.target.value)}
            placeholder={'ticket_id,customer_id,customer_name,resolution_details,satisfaction_rating\nTKT-1,cus_1,Ada,Logs attached,5'}
          />
        </label>
      ) : null}

      {headers.length > 0 && fields.length > 0 && kind !== "wave_database" ? (
        <div className="ds-mapping">
          <header className="ds-mapping-header">
            <h3>Column mapping</h3>
            <p>
              Each agent field must use a different source column. Ticket ID maps to the ticket
              identifier, not customer columns.
            </p>
          </header>
          <div className="ds-mapping-table" role="table" aria-label="Column mapping">
            <div className="ds-mapping-row ds-mapping-head" role="row">
              <span role="columnheader">Agent field</span>
              <span role="columnheader">Source column</span>
              <span role="columnheader">Sample value</span>
              <span role="columnheader">Status</span>
            </div>
            {fields.map((field) => {
              const selected = mapping[field.key] ?? "";
              const usedBy = Object.entries(mapping).find(
                ([key, column]) => key !== field.key && column && column === selected
              );
              const sample =
                selected && payload?.preview?.sampleRows?.[0]
                  ? String(payload.preview.sampleRows[0][selected] ?? "")
                  : "";
              const matched = Boolean(selected) && !usedBy;
              return (
                <label key={field.key} className={`ds-mapping-row${matched ? " is-matched" : " is-needed"}`} role="row">
                  <span className="ds-mapping-field" role="cell">
                    <strong>
                      {field.key === "resolution_details" ? "Evidence / resolution" : field.label}
                    </strong>
                    <small>
                      {field.key}
                      {field.required ? " · required" : ""}
                    </small>
                  </span>
                  <span role="cell">
                    <select
                      className="ds-select"
                      value={selected}
                      aria-label={`Source column for ${field.label}`}
                      onChange={(event) =>
                        setMapping((current) => ({ ...current, [field.key]: event.target.value }))
                      }
                    >
                      <option value="">Select a column…</option>
                      {headers.map((header) => (
                        <option key={`${field.key}-${header}`} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span className="ds-mapping-sample" role="cell" title={sample}>
                    {sample || "—"}
                  </span>
                  <span className={`ds-mapping-status${matched ? " is-ok" : " is-warn"}`} role="cell">
                    {usedBy ? "Column already used" : matched ? "Matched" : "Needs mapping"}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="ds-source-status">
        {verified && !empty ? (
          <p className="is-success">Source verified. {config?.isSample ? "Sample data — not a live integration." : "Live connected data."}</p>
        ) : null}
        {verified && empty ? (
          <p className="is-empty">Source is connected but returned 0 records. Add rows, then run again.</p>
        ) : null}
        {!verified && config?.lastError ? <p className="is-fail">{config.lastError}</p> : null}
      </div>

      <button type="button" className="prep-btn prep-btn-primary" disabled={saving} onClick={() => void save()}>
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Saving…
          </>
        ) : (
          "Save and verify data source"
        )}
      </button>
      {verified && !empty ? (
        <p className="prep-hint">Data source is connected. Review & Continue can open the Test Agent page.</p>
      ) : null}
    </section>
  );
}
