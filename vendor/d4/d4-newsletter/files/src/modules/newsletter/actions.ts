"use server";

import { assertAuthenticated } from "@/lib/cms/auth";
import { getSubscribers, saveSubscribers, toCsv } from "./data";
import type { Subscriber } from "./types";

export async function getSubscribersAction(): Promise<{ subscribers: Subscriber[]; error?: string }> {
  try {
    await assertAuthenticated();
    return { subscribers: await getSubscribers() };
  } catch (e) {
    return { subscribers: [], error: String(e) };
  }
}

/** Remove someone by hand, on request. */
export async function removeSubscriberAction(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    await assertAuthenticated();
    const subs = await getSubscribers();
    await saveSubscribers(subs.filter((s) => s.id !== id));
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/** Mark someone as unsubscribed without deleting the record. */
export async function unsubscribeAction(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    await assertAuthenticated();
    const subs = await getSubscribers();
    await saveSubscribers(
      subs.map((s) => (s.id === id ? { ...s, unsubscribedAt: s.unsubscribedAt ?? new Date().toISOString() } : s))
    );
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function exportCsvAction(): Promise<{ csv?: string; error?: string }> {
  try {
    await assertAuthenticated();
    return { csv: toCsv(await getSubscribers()) };
  } catch (e) {
    return { error: String(e) };
  }
}
