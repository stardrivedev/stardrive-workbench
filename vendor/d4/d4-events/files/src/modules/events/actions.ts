"use server";

import { revalidatePath } from "next/cache";
import { assertAuthenticated } from "@/lib/cms/auth";
import { getEvents, saveEvents } from "./data";
import type { SiteEvent } from "./types";

export async function getEventsAction(): Promise<{ events: SiteEvent[]; error?: string }> {
  try {
    await assertAuthenticated();
    return { events: await getEvents() };
  } catch (e) {
    return { events: [], error: String(e) };
  }
}

export async function saveEventsAction(events: SiteEvent[]): Promise<{ success: boolean; error?: string }> {
  try {
    await assertAuthenticated();
    await saveEvents(events);
    revalidatePath("/events");
    revalidatePath("/");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
