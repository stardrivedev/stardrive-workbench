import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublishedPage, getPublishedPages } from "@/modules/legal/data";
import { renderMarkdown } from "@/lib/cms/markdown";
import PageHeader from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublishedPage(slug);
  return { title: page?.title ?? "Legal" };
}

export async function generateStaticParams() {
  return (await getPublishedPages()).map((p) => ({ slug: p.slug }));
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getPublishedPage(slug);
  // An unreviewed page is not merely hidden, it is a 404. A draft that is
  // reachable by guessing the URL is a published draft.
  if (!page) notFound();

  return (
    <>
      <PageHeader eyebrow="Legal" title={page.title} />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div
          className="prose-sm space-y-4 text-sm leading-7 [&_a]:text-accent [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_strong]:font-semibold"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(page.body) }}
        />
        {page.updatedAt ? (
          <p className="mt-10 border-t border-heading/10 pt-4 text-xs text-muted">
            Last updated {page.updatedAt}.
          </p>
        ) : null}
      </section>
    </>
  );
}
