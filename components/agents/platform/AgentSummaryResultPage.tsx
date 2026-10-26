"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  ImagePlus,
  Loader2,
  RefreshCw,
  Sparkles,
  Wand2,
} from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import Skeleton from "@/components/ui/Skeleton";
import MarkdownDocument from "@/components/agents/results/MarkdownDocument";
import {
  loadLastRunResult,
  saveLastRunResult,
  type LastRunResult,
} from "@/lib/agents/runtime/last-run-result";
import type { ConceptImage } from "@/lib/agents/runtime/concept-image";
import {
  ASPECT_RATIOS,
  DEFAULT_IMAGE_GEN,
  IMAGE_QUALITIES,
  IMAGE_STYLES,
  parseAspectRatio,
  parseImageQuality,
  parseImageStyle,
  type AspectRatioId,
  type ImageQualityId,
  type ImageStyleId,
} from "@/lib/images/types";

function downloadImage(dataUrl: string, name: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function AgentSummaryResultPage() {
  const params = useParams();
  const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
  const [result, setResult] = useState<LastRunResult | null | undefined>(undefined);
  const [activeIndex, setActiveIndex] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const [style, setStyle] = useState<ImageStyleId>(DEFAULT_IMAGE_GEN.style);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioId>(DEFAULT_IMAGE_GEN.aspectRatio);
  const [quality, setQuality] = useState<ImageQualityId>(DEFAULT_IMAGE_GEN.quality);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId) return;
    const local = loadLastRunResult(agentId);
    if (local) {
      setResult(local);
      setPromptDraft(local.imagePrompt || local.conceptImages?.[0]?.prompt || local.summary);
      setStyle(parseImageStyle(local.imageStyle));
      setAspectRatio(parseAspectRatio(local.aspectRatio));
      setQuality(parseImageQuality(local.imageQuality));
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/v1/agents/${encodeURIComponent(agentId)}/runs?limit=1`
        );
        const payload = (await response.json()) as {
          runs?: Array<{ status?: string; summary?: string | null; createdAt?: string }>;
        };
        const latest = payload.runs?.find(
          (run) => run.status === "completed" && Boolean(run.summary?.trim())
        );
        if (cancelled) return;
        if (!latest?.summary) {
          setResult(null);
          return;
        }
        setResult({
          agentId,
          agentName: "Wave result",
          summary: latest.summary,
          createdAt: latest.createdAt ?? new Date().toISOString(),
        });
      } catch {
        if (!cancelled) setResult(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const persist = (next: LastRunResult) => {
    setResult(next);
    saveLastRunResult(next);
  };

  const generate = async (mode: "again" | "variation" | "edit") => {
    if (!result || generating) return;
    const prompt =
      mode === "edit" ? promptDraft.trim() : result.imagePrompt || promptDraft.trim() || result.summary;
    if (prompt.length < 8) {
      setActionError("Write a longer image prompt before generating.");
      return;
    }
    setGenerating(true);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/v1/agents/${encodeURIComponent(agentId)}/platform/generate-image`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            photoDataUrl: result.photoPreview,
            photoName: result.photoName,
            prompt,
            title: mode === "variation" ? "Variation" : result.conceptImages?.[activeIndex]?.title || "Generated image",
            style,
            aspectRatio,
            quality,
            variation: mode === "variation",
          }),
        }
      );
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        errorKind?: string;
        retryable?: boolean;
        image?: ConceptImage;
        provider?: string;
        model?: string;
      };
      if (!payload.success || !payload.image?.dataUrl) {
        setActionError(payload.error || "Gemini did not return an image.");
        persist({
          ...result,
          generationError: payload.error || "Gemini did not return an image.",
          generationErrorKind: payload.errorKind,
          generationRetryable: payload.retryable ?? false,
        });
        return;
      }
      const images = [...(result.conceptImages ?? [])];
      if (mode === "variation") images.unshift(payload.image);
      else if (images[activeIndex]) images[activeIndex] = payload.image;
      else images.unshift(payload.image);
      const next: LastRunResult = {
        ...result,
        conceptImages: images.slice(0, 4),
        generationError: undefined,
        generationErrorKind: undefined,
        generationRetryable: false,
        generationProvider: payload.provider,
        generationModel: payload.model,
        imagePrompt: payload.image.prompt || prompt,
        imageStyle: style,
        aspectRatio,
        imageQuality: quality,
      };
      persist(next);
      setActiveIndex(0);
      setEditing(false);
      setPromptDraft(payload.image.prompt || prompt);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Image generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  if (result === undefined) {
    return (
      <PageShell layout="workspace" className="studio-shell studio-shell-scroll">
        <Skeleton lines={6} />
      </PageShell>
    );
  }

  const photoJob =
    result?.kind === "photo" ||
    Boolean(result?.photoPreview) ||
    /venue photo|uploaded photo|decoration concept/i.test(result?.summary ?? "");
  const inputHref = photoJob
    ? `/agents/${encodeURIComponent(agentId)}/photo`
    : `/agents/${encodeURIComponent(agentId)}/run`;

  if (!result) {
    return (
      <PageShell layout="workspace" className="studio-shell studio-shell-scroll">
        <div className="summary-page">
          <div className="summary-stage">
            <h1>No result yet</h1>
            <p className="summary-empty">
              Upload a venue photo or paste a link first. Wave does not keep a made-up result here.
            </p>
            <Link href={`/agents/${encodeURIComponent(agentId)}/photo`} className="studio-primary">
              Upload a photo
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }

  const images = result.conceptImages ?? [];
  const active = images[activeIndex] ?? images[0];
  const statusLabel = generating
    ? "Generating with Gemini Flash Image…"
    : active && result.generationProvider === "gemini"
      ? `Generated with Gemini Flash Image${result.generationModel ? ` · ${result.generationModel}` : ""}`
      : active
        ? "Saved image from the last run"
        : result.generationError
          ? "Image generation failed"
          : "No image generated";

  return (
    <PageShell layout="workspace" className="studio-shell studio-shell-scroll">
      <div className={`summary-page ${photoJob ? "photo-result-page" : ""}`}>
        <div className={`summary-stage ${photoJob ? "photo-result-stage" : ""}`}>
          <div className="summary-top">
            <Link href={inputHref} className="summary-back">
              <ArrowLeft className="h-4 w-4" />
              {photoJob ? "New photo" : "New link"}
            </Link>
            <p className="studio-kicker">{photoJob ? "AI image" : "Summary"}</p>
          </div>
          <h1>{result.agentName || "Result"}</h1>
          {result.sourceUrl ? (
            <a
              className="summary-source"
              href={result.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              {result.sourceUrl}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
          {result.focus ? <p className="summary-focus">Focus: {result.focus}</p> : null}
          {result.photoName ? <p className="summary-focus">Photo: {result.photoName}</p> : null}

          {photoJob ? (
            <div className="image-result-layout">
              <section className="image-hero" aria-live="polite">
                {generating ? (
                  <div className="image-hero-state">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <p>Generating a high-resolution image. This uses Gemini and is billed by Google.</p>
                  </div>
                ) : active ? (
                  <img src={active.dataUrl} alt={active.title} />
                ) : (
                  <div className="image-hero-state">
                    <ImagePlus className="h-8 w-8" />
                    <p>
                      {result.generationError ||
                        "No generated image is available. Generate again after adding GEMINI_API_KEY."}
                    </p>
                  </div>
                )}
              </section>

              <aside className="image-result-meta">
                <p className={`image-status ${active && !generating ? "is-ready" : ""} ${result.generationError && !active ? "is-error" : ""}`}>
                  {statusLabel}
                </p>
                {result.photoPreview ? (
                  <figure className="image-reference">
                    <img src={result.photoPreview} alt={result.photoName || "Original photo"} />
                    <figcaption>Original photo</figcaption>
                  </figure>
                ) : (
                  <p className="summary-focus">Original photo is not stored in this tab. Upload again to compare.</p>
                )}

                <div className="image-gen-controls compact">
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
                    <span>Aspect</span>
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
                </div>

                <div className="prompt-block">
                  <div className="prompt-block-top">
                    <span>Prompt summary</span>
                    <button type="button" className="text-btn" onClick={() => setEditing((value) => !value)}>
                      {editing ? "Close" : "Edit prompt"}
                    </button>
                  </div>
                  {editing ? (
                    <textarea
                      value={promptDraft}
                      onChange={(event) => setPromptDraft(event.target.value)}
                      rows={8}
                    />
                  ) : (
                    <p>{(active?.prompt || result.imagePrompt || result.summary).slice(0, 420)}</p>
                  )}
                </div>

                <div className="image-actions">
                  {result.generationRetryable ? (
                    <button
                      type="button"
                      className="studio-primary"
                      disabled={generating}
                      onClick={() => void generate("again")}
                    >
                      {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      Retry
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="studio-primary"
                      disabled={generating}
                      onClick={() => void generate(editing ? "edit" : "again")}
                    >
                      {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      {editing ? "Generate with prompt" : "Generate again"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="studio-secondary"
                    disabled={generating}
                    onClick={() => void generate("variation")}
                  >
                    <Sparkles className="h-4 w-4" />
                    Create variation
                  </button>
                  <button
                    type="button"
                    className="studio-secondary"
                    disabled={generating}
                    onClick={() => setEditing(true)}
                  >
                    <Wand2 className="h-4 w-4" />
                    Edit prompt
                  </button>
                  <button
                    type="button"
                    className="studio-secondary"
                    disabled={!active || generating}
                    onClick={() =>
                      active &&
                      downloadImage(
                        active.dataUrl,
                        `${(active.title || "wave-image").replace(/\s+/g, "-").toLowerCase()}.png`
                      )
                    }
                  >
                    <Download className="h-4 w-4" />
                    Download image
                  </button>
                </div>
                {actionError ? <p className="image-error">{actionError}</p> : null}
                {images.length > 1 ? (
                  <div className="image-thumbs">
                    {images.map((image, index) => (
                      <button
                        key={`${image.title}-${index}`}
                        type="button"
                        className={index === activeIndex ? "is-active" : ""}
                        onClick={() => setActiveIndex(index)}
                      >
                        <img src={image.dataUrl} alt={image.title} />
                      </button>
                    ))}
                  </div>
                ) : null}
                <Link href={inputHref} className="photo-result-again">
                  Upload another photo
                </Link>
              </aside>
            </div>
          ) : (
            <article className="summary-card">
              <div className="summary-legend" aria-hidden="true">
                <span className="is-main">Main points</span>
                <span className="is-body">Supporting detail</span>
              </div>
              <MarkdownDocument markdown={result.summary} variant="colored-summary" />
            </article>
          )}

          {photoJob ? (
            <article className="summary-card image-notes-card">
              <p className="photo-result-label">Notes from the photo</p>
              <MarkdownDocument markdown={result.summary} variant="colored-summary" />
            </article>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}
