import { getTestimonials, byNewest } from "./data";
import type { Testimonial } from "./types";

/** Filled and empty stars, drawn rather than imported, so the module carries
 *  no icon dependency. Rendered as one accessible label, not five images. */
function Stars({ rating }: { rating: number }) {
  const filled = Math.round(rating);
  return (
    <p className="flex gap-0.5 text-accent" aria-label={`Rated ${filled} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill={n <= filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5">
          <path d="M10 1.8l2.5 5.1 5.6.8-4 3.9 1 5.6L10 14.6 4.9 17.2l1-5.6-4-3.9 5.6-.8z" strokeLinejoin="round" />
        </svg>
      ))}
    </p>
  );
}

export function TestimonialCard({ item }: { item: Testimonial }) {
  return (
    <figure className="flex h-full flex-col rounded-lg border border-heading/10 bg-surface p-6">
      {typeof item.rating === "number" && item.rating > 0 ? <Stars rating={item.rating} /> : null}
      <blockquote className="mt-3 flex-1 text-sm leading-6 text-body">
        <p>&ldquo;{item.quote}&rdquo;</p>
      </blockquote>
      <figcaption className="mt-5 flex items-center gap-3 border-t border-heading/10 pt-4">
        {item.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.photo} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
        ) : null}
        <span>
          <span className="block text-sm font-semibold">{item.author}</span>
          {item.role ? <span className="block text-xs text-muted">{item.role}</span> : null}
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * Embeddable strip. Any page can drop this in:
 *   <Testimonials limit={3} title="What our clients say" />
 * Renders nothing at all when there are no testimonials, so a page that
 * embeds it does not grow an empty heading on a new site.
 */
export default async function Testimonials({
  limit = 3,
  title = "What our clients say",
  featuredOnly = true,
}: {
  limit?: number;
  title?: string;
  featuredOnly?: boolean;
}) {
  const all = byNewest(await getTestimonials());
  const pool = featuredOnly && all.some((t) => t.featured) ? all.filter((t) => t.featured) : all;
  const items = pool.slice(0, limit);
  if (!items.length) return null;

  return (
    <section className="border-t border-heading/10">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((t) => (
            <TestimonialCard key={t.id} item={t} />
          ))}
        </div>
      </div>
    </section>
  );
}
