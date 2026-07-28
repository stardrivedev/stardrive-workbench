import {
  getLocations,
  formatAddress,
  formatTime,
  directionsUrl,
  mapEmbedUrl,
  isOpenNow,
  hoursForDay,
} from "./data";
import { DAY_NAMES } from "./types";
import type { Location } from "./types";

function OpenIndicator({ open }: { open: boolean | null }) {
  // No timezone means no claim. Silence beats sending someone to a locked door.
  if (open === null) return null;
  return (
    <p className={`text-sm font-medium ${open ? "text-accent" : "text-muted"}`}>
      {open ? "Open now" : "Closed now"}
    </p>
  );
}

function HoursTable({ location }: { location: Location }) {
  // Monday first: the week as a trading week, not as a calendar array.
  const order = [1, 2, 3, 4, 5, 6, 0];
  if (!location.hours.length) return null;
  return (
    <table className="mt-4 w-full text-sm">
      <caption className="sr-only">Opening hours for {location.name}</caption>
      <tbody>
        {order.map((day) => {
          const h = hoursForDay(location.hours, day);
          const label =
            !h || h.closed || !h.opens || !h.closes
              ? "Closed"
              : `${formatTime(h.opens)} to ${formatTime(h.closes)}`;
          return (
            <tr key={day} className="border-b border-heading/10 last:border-0">
              <th scope="row" className="py-1.5 text-left font-normal text-muted">{DAY_NAMES[day]}</th>
              <td className="py-1.5 text-right tabular-nums">{label}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function LocationCard({ location }: { location: Location }) {
  const address = formatAddress(location.address);
  const embed = mapEmbedUrl(location);

  return (
    <article className="overflow-hidden rounded-lg border border-heading/10 bg-surface">
      <div className="grid gap-6 p-6 sm:grid-cols-2 sm:p-8">
        <div>
          <h2 className="text-xl font-semibold">{location.name}</h2>
          <OpenIndicator open={isOpenNow(location)} />
          {address ? <address className="mt-3 not-italic text-sm leading-6 text-body">{address}</address> : null}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {location.phone ? (
              <a href={`tel:${location.phone.replace(/[^\d+]/g, "")}`} className="text-accent hover:underline">{location.phone}</a>
            ) : null}
            {location.email ? (
              <a href={`mailto:${location.email}`} className="text-accent hover:underline">{location.email}</a>
            ) : null}
            {address ? (
              <a href={directionsUrl(location)} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                Get directions
              </a>
            ) : null}
          </div>
          {location.notes ? <p className="mt-4 whitespace-pre-line text-sm text-muted">{location.notes}</p> : null}
          <HoursTable location={location} />
        </div>

        {embed ? (
          <div className="min-h-[260px] overflow-hidden rounded-md border border-heading/10">
            <iframe
              src={embed}
              title={`Map showing ${location.name}`}
              loading="lazy"
              className="h-full min-h-[260px] w-full"
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}

/**
 * Embeddable block, for a contact page or a footer area:
 *   <Locations limit={1} />
 * Renders nothing when no location has been entered.
 */
export default async function Locations({ limit, title }: { limit?: number; title?: string }) {
  const all = await getLocations();
  const items = typeof limit === "number" ? all.slice(0, limit) : all;
  if (!items.length) return null;

  return (
    <section className="border-t border-heading/10">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        {title ? <h2 className="mb-8 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2> : null}
        <div className="space-y-6">
          {items.map((l) => (
            <LocationCard key={l.id} location={l} />
          ))}
        </div>
      </div>
    </section>
  );
}
