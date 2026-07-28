"use server";

import { revalidatePath } from "next/cache";
import { assertAuthenticated } from "@/lib/cms/auth";
import { getPaymentItems, savePaymentItems } from "./data";
import { safePaymentUrl } from "./types";
import type { PaymentItem } from "./types";

export async function getPaymentItemsAction(): Promise<{ items: PaymentItem[]; error?: string }> {
  try {
    await assertAuthenticated();
    return { items: await getPaymentItems() };
  } catch (e) {
    return { items: [], error: String(e) };
  }
}

export async function savePaymentItemsAction(items: PaymentItem[]): Promise<{ success: boolean; error?: string }> {
  try {
    await assertAuthenticated();
    // Checked again on the server: the browser is not the place this rule is
    // enforced, and a non-https URL must never reach the collection.
    const bad = items.find((i) => !safePaymentUrl(i.url));
    if (bad) {
      return { success: false, error: `"${bad.name || "An item"}" needs a full https payment link.` };
    }
    await savePaymentItems(items);
    revalidatePath("/pay");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
