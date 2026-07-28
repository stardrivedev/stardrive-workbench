/**
 * Pure presentation helpers, safe on both sides of the network.
 *
 * These live apart from data.ts deliberately. data.ts imports the libSQL data
 * store, which imports `fs`, so anything a CLIENT component touches must not
 * come from there: one such import pulls `fs` into the browser bundle and the
 * build fails. The admin editor needs this formatting, so it lives here.
 */
import type { SiteEvent } from "./types";

/** The last calendar date an event covers. */
const lastDay = (e: SiteEvent) => e.endDate || e.date;

/**
 * Upcoming means "has not finished yet", by calendar date rather than by
 * instant. An event on today stays listed all day instead of vanishing at
 * midnight UTC while the doors are still open.
 */
export function splitEvents(events: SiteEvent[], today = new Date().toISOString().slice(0, 10)) {
  const upcoming = events
    .filter((e) => lastDay(e) >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? ""));
  const past = events
    .filter((e) => lastDay(e) < today)
    .sort((a, b) => b.date.localeCompare(a.date));
  return { upcoming, past };
}

/** "2026-08-15" as "Saturday 15 August 2026". */
export function friendlyDate(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${dateStr}T12:00:00Z`));
  } catch {
    return dateStr;
  }
}

/** "19:30" as "7:30pm". */
export function friendlyTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm;
  const h = Number(m[1]);
  const mins = Number(m[2]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${mins ? `:${String(mins).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** The when line: date, plus times and an end date only when they exist. */
export function whenLabel(e: SiteEvent): string {
  const parts = [friendlyDate(e.date)];
  if (e.endDate && e.endDate !== e.date) parts.push(`to ${friendlyDate(e.endDate)}`);
  if (e.startTime) {
    parts.push(e.endTime ? `${friendlyTime(e.startTime)} to ${friendlyTime(e.endTime)}` : friendlyTime(e.startTime));
  }
  return parts.join(", ");
}
