import { getEvents } from "./data";
import { splitEvents, whenLabel } from "./format";
import type { SiteEvent } from "./types";

export function EventCard({ event, past = false }: { event: SiteEvent; past?: boolean }) {
  return (
    <article className={`overflow-hidden rounded-lg border border-heading/10 bg-surface ${past ? "opacity-70" : ""}`}>
      {event.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={event.image} alt="" className="h-44 w-full object-cover" />
      ) : null}
      <div className="p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-accent">{whenLabel(event)}</p>
        <h3 className="mt-2 text-lg font-semibold">{event.title}</h3>
        {event.venue || event.address ? (
          <p className="mt-1 text-sm text-muted">{[event.venue, event.address].filter(Boolean).join(", ")}</p>
        ) : null}
        {event.description ? (
          <p className="mt-3 whitespace-pre-line text-sm leading-6 text-body">{event.description}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          {event.price ? <span className="font-medium">{event.price}</span> : null}
          {event.ticketUrl && !past ? (
            <a
              href={event.ticketUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong"
            >
              Book tickets
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/**
 * Embeddable strip of what is coming up:
 *   <Events limit={3} title="What's on" />
 * Renders nothing when there is nothing upcoming, so a quiet month leaves no
 * empty heading behind.
 */
export default async function Events({ limit = 3, title = "What's on" }: { limit?: number; title?: string }) {
  const { upcoming } = splitEvents(await getEvents());
  const items = upcoming.slice(0, limit);
  if (!items.length) return null;

  return (
    <section className="border-t border-heading/10">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </div>
      </div>
    </section>
  );
}
