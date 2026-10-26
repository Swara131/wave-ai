import TemplateGuestPreviewPage from "@/components/landing/TemplateGuestPreviewPage";
import { isPublicGallerySlug } from "@/lib/templates/public-gallery";
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function PublicTemplatePreviewPage({ params }: PageProps) {
  const { slug } = await params;
  if (!isPublicGallerySlug(slug)) notFound();
  return <TemplateGuestPreviewPage slug={slug} />;
}
