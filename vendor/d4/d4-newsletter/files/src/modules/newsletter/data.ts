/** Server-only accessors for the subscriber list. */
import { readCollection, writeCollection } from "@/lib/cms/data-store";
import type { Subscriber } from "./types";

export function getSubscribers(): Promise<Subscriber[]> {
  return readCollection<Subscriber[]>("subscribers", []);
}

export function saveSubscribers(subs: Subscriber[]): Promise<void> {
  return writeCollection("subscribers", subs);
}

export const isActive = (s: Subscriber) => !s.unsubscribedAt;

/** Addresses are matched case-insensitively; nobody types their own the same
 *  way twice, and two rows for one person is a duplicate send. */
export const sameAddress = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * CSV for whichever sending platform the owner uses. Every field is quoted and
 * embedded quotes are doubled, so a name containing a comma cannot shift the
 * columns. A leading =, +, - or @ is prefixed with a quote: without that, a
 * crafted "name" becomes a live formula when the file opens in a spreadsheet.
 */
export function toCsv(subs: Subscriber[]): string {
  const escape = (value: string | undefined) => {
    const raw = String(value ?? "");
    const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const header = ["email", "name", "subscribed_at", "source", "status"];
  const rows = subs.map((s) =>
    [
      escape(s.email),
      escape(s.name),
      escape(s.subscribedAt),
      escape(s.source),
      escape(isActive(s) ? "subscribed" : "unsubscribed"),
    ].join(",")
  );
  return [header.join(","), ...rows].join("\r\n");
}
