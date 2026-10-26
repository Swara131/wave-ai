import Link from "next/link";
import { Compass, Heart, Lamp, Users } from "lucide-react";
import { getPublicGalleryTemplates } from "@/lib/templates/public-gallery";

const ICONS = {
  Lamp,
  Compass,
  Heart,
  Users,
} as const;

export default function LandingTemplateShowcase() {
  const templates = getPublicGalleryTemplates();

  return (
    <section className="landing-section" id="templates">
      <div className="mx-auto max-w-6xl">
        <p className="landing-kicker">Ready-made agents</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight">
          Try four working templates before you sign in.
        </h2>
        <p className="mt-3 max-w-2xl text-[var(--text-secondary)]">
          Open a preview, enter preferences, and generate a real plan. Saving history and
          protected actions requires an account.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {templates.map((template) => {
            const Icon =
              ICONS[template.icon as keyof typeof ICONS] ?? Lamp;
            return (
              <article key={template.slug} className="landing-card flex h-full flex-col p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
                  <Icon className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                </div>
                <h3 className="mt-4 text-base font-semibold">{template.name}</h3>
                <p className="mt-2 flex-1 text-sm text-[var(--text-secondary)]">
                  {template.shortDescription}
                </p>
                <ul className="mt-4 space-y-1.5 text-xs text-[var(--text-secondary)]">
                  {template.capabilities.map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
                <div className="mt-5 flex flex-col gap-2">
                  <Link
                    href={template.previewHref}
                    className="landing-cta-primary rounded-full px-4 py-2 text-center text-sm font-semibold"
                  >
                    Try Template
                  </Link>
                  <Link
                    href={template.signInHref}
                    className="landing-cta-secondary rounded-full px-4 py-2 text-center text-sm font-semibold"
                  >
                    Sign in to save
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
