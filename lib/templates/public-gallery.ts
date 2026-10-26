import { MARKETPLACE_TEMPLATES } from "./marketplace-catalog";
import type { AgentTemplate } from "./types";

export const PUBLIC_GALLERY_SLUGS = [
  "lighting-concierge",
  "travel-companion",
  "wedding-celebration-planner",
  "group-decision-planner",
] as const;

export type PublicGallerySlug = (typeof PUBLIC_GALLERY_SLUGS)[number];

export interface PublicGalleryTemplate {
  slug: PublicGallerySlug;
  name: string;
  shortDescription: string;
  icon: string;
  capabilities: string[];
  previewHref: string;
  signInHref: string;
  usesQloo: boolean;
}

const CAPABILITIES: Record<PublicGallerySlug, string[]> = {
  "lighting-concierge": [
    "Room lighting plan from stated preferences",
    "Itemised estimate from the configured rate table",
    "Quote and address checks before any visit request",
  ],
  "travel-companion": [
    "Day-by-day itinerary for one city",
    "Unverified prices, hours, and availability labelled",
    "Booking requests stay pending without a provider",
  ],
  "wedding-celebration-planner": [
    "Plan, budget breakdown, and task checklist",
    "Vendor comparison from organizer-entered quotes",
    "Deposit threshold and allowlist safety",
  ],
  "group-decision-planner": [
    "Separate taste profiles for each friend",
    "Fairness-aware restaurant ranking",
    "Not-for-me re-ranking after you save the outing",
  ],
};

export function isPublicGallerySlug(value: string): value is PublicGallerySlug {
  return (PUBLIC_GALLERY_SLUGS as readonly string[]).includes(value);
}

export function getPublicGalleryTemplates(): PublicGalleryTemplate[] {
  return PUBLIC_GALLERY_SLUGS.map((slug) => {
    const template = MARKETPLACE_TEMPLATES.find((item) => item.slug === slug) as AgentTemplate | undefined;
    if (!template) {
      throw new Error(`Public gallery is missing marketplace template ${slug}.`);
    }
    return {
      slug,
      name: template.name,
      shortDescription:
        template.shortDescription ??
        template.longDescription?.slice(0, 160) ??
        template.name,
      icon: template.icon ?? "Sparkles",
      capabilities: CAPABILITIES[slug],
      previewHref: `/preview/${slug}`,
      signInHref: `/login?redirectTo=${encodeURIComponent(`/preview/${slug}`)}`,
      usesQloo: slug !== "wedding-celebration-planner",
    };
  });
}
