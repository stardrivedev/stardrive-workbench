/**
 * Timezone arithmetic, with Intl and no date library.
 *
 * A booking diary has exactly one hard requirement: 10am must mean 10am where
 * the business is, in June and in December, whatever clock the server keeps.
 * That rules out storing local strings and it rules out `new Date(local)`,
 * which silently uses the server's zone. So instants are stored in UTC and
 * converted through the business's IANA zone at both ends.
 */

/**
 * How far the named zone is from UTC, in minutes, at a given instant.
 * Formats the instant in that zone, reads the wall clock back, and takes the
 * difference. This is the standard trick and it is exact outside the one
 * ambiguous hour when clocks go back.
 */
export function zoneOffsetMinutes(at: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    return (asUtc - at.getTime()) / 60000;
  } catch {
    return 0; // an unusable zone behaves as UTC rather than throwing mid-render
  }
}

/**
 * A wall-clock date and time in a zone, as a real instant.
 *
 * Two passes: guess with the offset at the naive instant, then recompute the
 * offset at the corrected instant and apply it again. One pass is wrong for
 * bookings that sit on the far side of a DST change from today; two passes
 * settles everywhere except inside the shifted hour itself.
 */
export function zonedToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const naive = new Date(`${dateStr}T${timeStr}:00Z`);
  if (Number.isNaN(naive.getTime())) return new Date(NaN);
  const first = new Date(naive.getTime() - zoneOffsetMinutes(naive, timeZone) * 60000);
  return new Date(naive.getTime() - zoneOffsetMinutes(first, timeZone) * 60000);
}

/** The wall-clock parts of an instant, as seen in a zone. */
export function partsInZone(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${String(Number(get("hour")) % 24).padStart(2, "0")}:${get("minute")}`,
    day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
  };
}

/** "2026-08-15" plus n days, staying on calendar dates rather than instants. */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Which weekday a calendar date falls on, independent of any zone. */
export function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

export const toMinutes = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
};

export const fromMinutes = (mins: number): string =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

/** 24-hour "14:30" as "2:30pm". */
export function friendlyTime(hhmm: string): string {
  const mins = toMinutes(hhmm);
  if (Number.isNaN(mins)) return hhmm;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** "2026-08-15" as "Saturday 15 August 2026", for headings and emails. */
export function friendlyDate(dateStr: string, timeZone = "UTC"): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(`${dateStr}T12:00:00Z`));
  } catch {
    return dateStr;
  }
}
