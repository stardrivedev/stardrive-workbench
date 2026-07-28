/**
 * Server-only accessors for events.
 *
 * Storage only. The date and label helpers live in format.ts because client
 * components need them, and importing this file from the browser would pull
 * the libSQL store (and `fs`) into the bundle.
 */
import { readCollection, writeCollection } from "@/lib/cms/data-store";
import { seedEvents } from "@/config/events.generated";
import type { SiteEvent } from "./types";

export function getEvents(): Promise<SiteEvent[]> {
  return readCollection<SiteEvent[]>("events", seedEvents);
}

export function saveEvents(events: SiteEvent[]): Promise<void> {
  return writeCollection("events", events);
}
