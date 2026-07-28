/** Server-only accessors and presentation helpers for locations. */
import { readCollection, writeCollection } from "@/lib/cms/data-store";
import { seedLocations } from "@/config/locations.generated";
import type { DayHours, Location, PostalAddress } from "./types";

export function getLocations(): Promise<Location[]> {
  return readCollection<Location[]>("locations", seedLocations);
}

export function saveLocations(locations: Location[]): Promise<void> {
  return writeCollection("locations", locations);
}

/** One-line address for display and for a maps query. */
export function formatAddress(a: PostalAddress): string {
  return [a.street, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(", ");
}

/**
 * A directions link that works everywhere without an API key or a billing
 * account: Google's documented universal maps URL, which opens the native app
 * on a phone and the web map on a desktop.
 */
export function directionsUrl(loc: Location): string {
  const query = loc.lat != null && loc.lng != null ? `${loc.lat},${loc.lng}` : formatAddress(loc.address);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * An OpenStreetMap embed URL. OSM needs no key and no account, which is why
 * it is here rather than a provider the owner would have to sign up for. A
 * small bounding box around the point gives a street-level view.
 */
export function mapEmbedUrl(loc: Location): string | null {
  if (loc.lat == null || loc.lng == null) return null;
  const d = 0.0045; // roughly a 500m box
  const bbox = [loc.lng - d, loc.lat - d, loc.lng + d, loc.lat + d].map((n) => n.toFixed(6)).join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${loc.lat},${loc.lng}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const toMinutes = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
};

/** "09:00" rendered for people, in the site's own locale-neutral style. */
export function formatTime(hhmm: string): string {
  const mins = toMinutes(hhmm);
  if (mins === null) return hhmm;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${pad(m)}${suffix}`;
}

/**
 * The current day and minute-of-day inside a named timezone, using Intl
 * rather than a date library. Returns null for a missing or invalid zone,
 * and callers then simply show no open/closed indicator: a wrong "Open now"
 * sends someone to a locked door, which is worse than no badge at all.
 */
function nowInZone(timezone?: string): { day: number; minutes: number } | null {
  if (!timezone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    if (dayIndex === -1) return null;
    // Intl can emit "24" for midnight in hour12:false; normalise it.
    const hour = Number(get("hour")) % 24;
    return { day: dayIndex, minutes: hour * 60 + Number(get("minute")) };
  } catch {
    return null;
  }
}

export function hoursForDay(hours: DayHours[], day: number): DayHours | undefined {
  return hours.find((h) => h.day === day);
}

/**
 * Is this location open right now? `null` means "we cannot say", which is a
 * distinct and honest answer from "closed".
 */
export function isOpenNow(loc: Location): boolean | null {
  const now = nowInZone(loc.timezone);
  if (!now) return null;
  const today = hoursForDay(loc.hours, now.day);
  if (!today || today.closed || !today.opens || !today.closes) return false;
  const opens = toMinutes(today.opens);
  const closes = toMinutes(today.closes);
  if (opens === null || closes === null) return null;
  // A closing time earlier than the opening time means it runs past midnight.
  return closes <= opens
    ? now.minutes >= opens || now.minutes < closes
    : now.minutes >= opens && now.minutes < closes;
}
