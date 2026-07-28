import type { Metadata } from "next";
import { getEvents } from "@/modules/events/data";
import { splitEvents } from "@/modules/events/format";
import { EventCard } from "@/modules/events/Events";
import PageHeader from "@/components/ui/PageHeader";
import JsonLd from "@/components/seo/JsonLd";
import { absoluteUrl } from "@/lib/seo";
import type { SiteEvent } from "@/modules/events/types";

export const metadata: Metadata = { title: "Events" };
export const dynamic = "force-dynamic";

/** Only what the owner actually entered. An event with no venue simply has no
 *  location in its markup, rather than a guessed one. */
function eventJsonLd(e: SiteEvent): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: e.title,
    startDate: e.startTime ? `${e.date}T${e.startTime}` : e.date,
    ...(e.endDate || e.endTime
      ? { endDate: e.endTime ? `${e.endDate || e.date}T${e.endTime}` : e.endDate }
      : {}),
    eventStatus: "https://schema.org/EventScheduled",
    ...(e.description ? { description: e.description } : {}),
    ...(e.image ? { image: absoluteUrl(e.image) } : {}),
    ...(e.venue || e.address
      ? {
          location: {
            "@type": "Place",
            name: e.venue || e.address,
            ...(e.address ? { address: e.address } : {}),
          },
        }
      : {}),
    ...(e.ticketUrl ? { offers: { "@type": "Offer", url: e.ticketUrl } } : {}),
  };
}

export default async function EventsPage() {
  const { upcoming, past } = splitEvents(await getEvents());

  return (
    <>
      <PageHeader eyebrow="Events" title="What's on" subtitle="Everything coming up, and what we have already run." slot="hero-events" />
      {upcoming.map((e) => (
        <JsonLd key={e.id} data={eventJsonLd(e)} />
      ))}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        {upcoming.length === 0 ? (
          <div className="rounded-md border border-heading/10 bg-surface px-6 py-8 text-sm text-muted">
            Nothing in the diary right now. Check back soon.
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        )}

        {past.length > 0 && (
          <div className="mt-16">
            <h2 className="text-xl font-semibold tracking-tight">Previously</h2>
            <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {past.slice(0, 9).map((e) => (
                <EventCard key={e.id} event={e} past />
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
