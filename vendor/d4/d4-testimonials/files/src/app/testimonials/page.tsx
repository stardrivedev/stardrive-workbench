import type { Metadata } from "next";
import { getTestimonials, byNewest, averageRating } from "@/modules/testimonials/data";
import { TestimonialCard } from "@/modules/testimonials/Testimonials";
import PageHeader from "@/components/ui/PageHeader";
import JsonLd from "@/components/seo/JsonLd";
import { siteConfig } from "@/config/site";
import { baseUrl } from "@/lib/seo";

export const metadata: Metadata = { title: "Testimonials" };
export const dynamic = "force-dynamic";

export default async function TestimonialsPage() {
  const items = byNewest(await getTestimonials());
  const average = averageRating(items);

  // Only claim an aggregate rating when real ratings exist. A made-up score
  // in structured data is the kind of thing that gets a site penalised.
  const jsonLd = average
    ? {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: siteConfig.name,
        url: baseUrl(),
        aggregateRating: {
          "@type": "AggregateRating",
          ratingValue: average.value,
          reviewCount: average.count,
          bestRating: 5,
        },
      }
    : null;

  return (
    <>
      <PageHeader
        eyebrow="Testimonials"
        title="What our clients say"
        subtitle={
          average
            ? `Rated ${average.value} out of 5 across ${average.count} review${average.count === 1 ? "" : "s"}.`
            : undefined
        }
        slot="hero-testimonials"
      />
      {jsonLd ? <JsonLd data={jsonLd} /> : null}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        {items.length === 0 ? (
          <div className="rounded-md border border-heading/10 bg-surface px-6 py-8 text-sm text-muted">
            No testimonials yet.
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((t) => (
              <TestimonialCard key={t.id} item={t} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
