"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, ImagePlus, Loader2, Upload } from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import Skeleton from "@/components/ui/Skeleton";
import ErrorState from "@/components/ui/ErrorState";
import type { AgentRequirementsResult } from "@/lib/agents/requirements/types";
import { saveLastRunResult } from "@/lib/agents/runtime/last-run-result";
import type { TestRunOutcomeKind } from "@/lib/agents/platform/test-run-outcome";
import {
  ASPECT_RATIOS,
  DEFAULT_IMAGE_GEN,
  IMAGE_QUALITIES,
  IMAGE_STYLES,
  type AspectRatioId,
  type ImageQualityId,
  type ImageStyleId,
} from "@/lib/images/types";

const PROCESS_STEPS = [
  "Reading the uploaded photo",
  "Writing a detailed image prompt",
  "Generating a high-resolution image",
];

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read that photo."));
    reader.readAsDataURL(blob);
  });
}

async function compressPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.size <= 2_400_000) return file;
  const bitmap = await createImageBitmap(file);
  const maxEdge = 2048;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((next) => resolve(next), "image/jpeg", 0.92);
  });
  return blob ?? file;
}

export default function AgentPhotoInputPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
  const [requirements, setRequirements] = useState<AgentRequirementsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [style, setStyle] = useState<ImageStyleId>(DEFAULT_IMAGE_GEN.style);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioId>(DEFAULT_IMAGE_GEN.aspectRatio);
  const [quality, setQuality] = useState<ImageQualityId>(DEFAULT_IMAGE_GEN.quality);
  const [variationCount, setVariationCount] = useState<1 | 2>(DEFAULT_IMAGE_GEN.count);
  const [outcome, setOutcome] = useState<TestRunOutcomeKind | null>(null);
  const [processIndex, setProcessIndex] = useState(0);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const response = await fetch(
        `/api/v1/agents/${encodeURIComponent(agentId)}/requirements?stage=test`
      );
      const payload = (await response.json()) as AgentRequirementsResult;
      setRequirements(payload);
      if (!payload.ready) {
        router.replace(`/agents/${encodeURIComponent(agentId)}/prepare`);
      }
    } catch {
      setError("Could not load the photo page.");
    } finally {
      setLoading(false);
    }
  }, [agentId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!running) return;
    setProcessIndex(0);
    const timer = window.setInterval(() => {
      setProcessIndex((index) => (index + 1) % PROCESS_STEPS.length);
    }, 1400);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const onPick = (next: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setPreview(next ? URL.createObjectURL(next) : null);
    setError(null);
  };

  const runAgent = async () => {
    if (!agentId || !file) return;
    setRunning(true);
    setError(null);
    setOutcome(null);
    try {
      const compressed = await compressPhoto(file);
      const previewUrl = await blobToDataUrl(compressed);
      const form = new FormData();
      const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
      form.append("photo", compressed, name);
      if (notes.trim()) form.append("notes", notes.trim());
      form.append("image_style", style);
      form.append("aspect_ratio", aspectRatio);
      form.append("image_quality", quality);
      form.append("variation_count", String(variationCount));
      const response = await fetch(
        `/api/v1/agents/${encodeURIComponent(agentId)}/platform/test`,
        { method: "POST", body: form }
      );
      const payload = (await response.json()) as {
        success?: boolean;
        outcome?: TestRunOutcomeKind;
        runSummary?: string | null;
        runError?: string | null;
        error?: string;
        conceptImages?: Array<{ title: string; dataUrl: string; prompt?: string }>;
        generationError?: string | null;
        generationProvider?: string | null;
        generationModel?: string | null;
        generationErrorKind?: string | null;
        generationRetryable?: boolean;
        proposalId?: string | null;
      };
      const nextOutcome = payload.outcome ?? (payload.success ? "success" : "failed");
      setOutcome(nextOutcome);
      if (nextOutcome === "awaiting_approval") {
        const proposalId = payload.proposalId?.trim();
        router.push(
          proposalId
            ? `/approvals?proposal=${encodeURIComponent(proposalId)}`
            : "/approvals"
        );
        return;
      }
      const summary = payload.runSummary?.trim() ?? "";
      if (summary && nextOutcome === "success") {
        saveLastRunResult({
          agentId,
          agentName: requirements?.agentName ?? "Custom Agent",
          summary,
          createdAt: new Date().toISOString(),
          photoPreview: previewUrl,
          photoName: file.name,
          kind: "photo",
          conceptImages: payload.conceptImages ?? [],
          generationError: payload.generationError ?? undefined,
          generationProvider: payload.generationProvider ?? undefined,
          generationModel: payload.generationModel ?? undefined,
          generationErrorKind: payload.generationErrorKind ?? undefined,
          generationRetryable: payload.generationRetryable ?? false,
          imageStyle: style,
          aspectRatio,
          imageQuality: quality,
          imagePrompt: payload.conceptImages?.[0]?.prompt,
        });
        router.push(`/agents/${encodeURIComponent(agentId)}/result`);
        return;
      }
      setError(
        payload.runError ??
          payload.error ??
          "Wave could not produce concepts from that photo."
      );
    } catch (err) {
      setOutcome("failed");
      setError(err instanceof Error ? err.message : "The run failed.");
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <PageShell layout="workspace" className="studio-shell studio-shell-scroll">
        <Skeleton lines={4} />
      </PageShell>
    );
  }

  return (
    <PageShell layout="workspace" className="studio-shell studio-shell-scroll">
      <div className="studio-prompt photo-page">
        <div className="studio-prompt-glow" />
        <div className="studio-prompt-stage studio-prompt-stage-narrow">
          <p className="studio-kicker">
            <ImagePlus className="h-3.5 w-3.5" />
            Step · Upload a real photo
          </p>
          <h1>Upload the venue photo</h1>
          <p className="studio-lead">
            Wave uses Gemini Flash Image with your photo as the reference. It will
            not invent a different place, prices, or stock photos.
          </p>

          <label
            className={`photo-drop ${preview ? "has-preview" : ""}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const next = event.dataTransfer.files[0];
              if (next) onPick(next);
            }}
          >
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="photo-drop-input"
              onChange={(event) => onPick(event.target.files?.[0] ?? null)}
            />
            {preview ? (
              <img src={preview} alt="Venue preview" className="photo-drop-preview" />
            ) : (
              <div className="photo-drop-empty">
                <Upload className="h-8 w-8" />
                <strong>Drop a photo here</strong>
                <span>or click to choose a JPEG, PNG, or WebP</span>
              </div>
            )}
          </label>
          {file ? <p className="photo-filename">{file.name}</p> : null}

          <div className="image-gen-controls">
            <label className="run-field">
              <span>Style</span>
              <select value={style} onChange={(event) => setStyle(event.target.value as ImageStyleId)}>
                {IMAGE_STYLES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="run-field">
              <span>Aspect ratio</span>
              <select
                value={aspectRatio}
                onChange={(event) => setAspectRatio(event.target.value as AspectRatioId)}
              >
                {ASPECT_RATIOS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="run-field">
              <span>Quality</span>
              <select
                value={quality}
                onChange={(event) => setQuality(event.target.value as ImageQualityId)}
              >
                {IMAGE_QUALITIES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="run-field">
              <span>Variations</span>
              <select
                value={variationCount}
                onChange={(event) => setVariationCount(Number(event.target.value) === 2 ? 2 : 1)}
              >
                <option value={1}>1 image</option>
                <option value={2}>2 images</option>
              </select>
            </label>
          </div>

          <label className="run-field">
            <span>Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Guest count, colors you already have, indoor or outdoor…"
              rows={3}
            />
            <small>Used only as extra context. Notes cannot replace the photo.</small>
          </label>

          <div className="studio-actions">
            <button
              type="button"
              className="studio-primary studio-primary-lg"
              disabled={!file || running}
              onClick={() => void runAgent()}
            >
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Reading the photo…
                </>
              ) : (
                <>
                  Generate concepts
                  <ArrowRight className="h-4 w-4 studio-arrow-nudge" />
                </>
              )}
            </button>
            <Link href={`/agents/${encodeURIComponent(agentId)}/test`} className="run-back">
              Back to test
            </Link>
          </div>

          {running ? (
            <ol className="studio-process">
              {PROCESS_STEPS.map((step, index) => (
                <li key={step} className={index === processIndex ? "is-current" : ""}>
                  <span />
                  {step}
                </li>
              ))}
            </ol>
          ) : null}

          {error && outcome !== "success" ? (
            <ErrorState
              title="No invented result."
              description={error}
              onFix={() => void runAgent()}
              fixLabel="Try another photo"
            />
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}
