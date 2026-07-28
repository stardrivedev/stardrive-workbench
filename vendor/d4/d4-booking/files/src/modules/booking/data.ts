/** Server-only accessors and slot logic for the booking diary. */
import { readCollection, writeCollection } from "@/lib/cms/data-store";
import { seedServices, seedAvailability } from "@/config/booking.generated";
import { DEFAULT_AVAILABILITY } from "./types";
import type { AvailabilitySettings, Booking, Service } from "./types";
import { addDays, fromMinutes, partsInZone, toMinutes, weekdayOf, zonedToUtc } from "./time";

export function getServices(): Promise<Service[]> {
  return readCollection<Service[]>("booking-services", seedServices);
}

export function saveServices(services: Service[]): Promise<void> {
  return writeCollection("booking-services", services);
}

export async function getAvailability(): Promise<AvailabilitySettings> {
  const stored = await readCollection<AvailabilitySettings | null>("booking-availability", null);
  return { ...DEFAULT_AVAILABILITY, ...seedAvailability, ...(stored ?? {}) };
}

export function saveAvailability(settings: AvailabilitySettings): Promise<void> {
  return writeCollection("booking-availability", settings);
}

export function getBookings(): Promise<Booking[]> {
  return readCollection<Booking[]>("bookings", []);
}

export function saveBookings(bookings: Booking[]): Promise<void> {
  return writeCollection("bookings", bookings);
}

/** Cancelled bookings free their slot again; everything else holds it. */
const holdsSlot = (b: Booking) => b.status !== "cancelled";

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart < bEnd && bStart < aEnd;

/**
 * Does this proposed appointment collide with the live diary? Kept separate
 * from slot generation because it is also the last check before a booking is
 * written, and the two must agree.
 */
export function conflictsWith(bookings: Booking[], startIso: string, endIso: string): boolean {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  return bookings.filter(holdsSlot).some((b) => overlaps(start, end, Date.parse(b.start), Date.parse(b.end)));
}

export interface Slot {
  /** The instant, for storage and for the form. */
  startIso: string;
  endIso: string;
  /** Wall clock in the business timezone, for the button label. */
  localTime: string;
}

/**
 * Every free start time for one service on one calendar date.
 *
 * Walks the weekly windows for that weekday in slot-interval steps, keeps only
 * whole appointments that finish inside the window, then drops anything too
 * soon (lead time) or already taken. The date is a calendar date in the
 * business's zone, so a customer in another country still books its 10am.
 */
export function slotsFor(
  service: Service,
  settings: AvailabilitySettings,
  bookings: Booking[],
  dateStr: string,
  now: Date = new Date()
): Slot[] {
  if (settings.closedDates?.includes(dateStr)) return [];

  const weekday = weekdayOf(dateStr);
  const windows = settings.windows.filter((w) => w.day === weekday);
  if (!windows.length) return [];

  const interval = Math.max(5, settings.slotIntervalMin || 30);
  const duration = Math.max(5, service.durationMin || 30);
  const earliest = now.getTime() + Math.max(0, settings.leadTimeHours || 0) * 3600_000;
  const out: Slot[] = [];

  for (const w of windows) {
    const open = toMinutes(w.start);
    const close = toMinutes(w.end);
    if (Number.isNaN(open) || Number.isNaN(close) || close <= open) continue;

    for (let m = open; m + duration <= close; m += interval) {
      const localTime = fromMinutes(m);
      const start = zonedToUtc(dateStr, localTime, settings.timezone);
      if (Number.isNaN(start.getTime())) continue;
      if (start.getTime() < earliest) continue;

      const end = new Date(start.getTime() + duration * 60000);
      const startIso = start.toISOString();
      const endIso = end.toISOString();
      if (conflictsWith(bookings, startIso, endIso)) continue;

      out.push({ startIso, endIso, localTime });
    }
  }

  return out.sort((a, b) => a.startIso.localeCompare(b.startIso));
}

/** The dates the calendar should offer, from today to the booking horizon. */
export function bookableDates(settings: AvailabilitySettings, now: Date = new Date()): string[] {
  const today = partsInZone(now, settings.timezone).date;
  const days = Math.max(1, Math.min(365, settings.maxDaysAhead || 60));
  const open = new Set(settings.windows.map((w) => w.day));
  const out: string[] = [];
  for (let i = 0; i <= days; i += 1) {
    const date = addDays(today, i);
    if (!open.has(weekdayOf(date))) continue;
    if (settings.closedDates?.includes(date)) continue;
    out.push(date);
  }
  return out;
}
