import type { Metadata } from "next";
import Link from "next/link";
import { getPublishedPages } from "@/modules/legal/data";
import PageHeader from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Legal" };
export const dynamic = "force-dynamic";

export default async function LegalIndexPage() {
  const pages = await getPublishedPages();

  return (
    <>
      <PageHeader eyebrow="Legal" title="Legal" />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        {pages.length === 0 ? (
          <p className="text-sm text-muted">No legal pages have been published yet.</p>
        ) : (
          <ul className="space-y-3">
            {pages.map((p) => (
              <li key={p.slug}>
                <Link href={`/legal/${p.slug}`} className="text-accent hover:underline">
                  {p.title}
                </Link>
                {p.updatedAt ? <span className="ml-2 text-xs text-muted">updated {p.updatedAt}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
