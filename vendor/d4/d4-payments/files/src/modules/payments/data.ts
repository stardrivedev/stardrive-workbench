/** Server-only accessors for payment items. */
import { readCollection, writeCollection } from "@/lib/cms/data-store";
import { seedPaymentItems } from "@/config/payments.generated";
import { safePaymentUrl } from "./types";
import type { PaymentItem } from "./types";

export function getPaymentItems(): Promise<PaymentItem[]> {
  return readCollection<PaymentItem[]>("payment-items", seedPaymentItems);
}

export function savePaymentItems(items: PaymentItem[]): Promise<void> {
  return writeCollection("payment-items", items);
}

/**
 * Items safe to render. An item whose URL fails the https check is dropped
 * rather than shown with a dead or dangerous button, because a Buy button that
 * does not take money is worse than no Buy button.
 */
export async function getPayableItems(): Promise<PaymentItem[]> {
  const items = await getPaymentItems();
  return items.filter((i) => !i.hidden && safePaymentUrl(i.url));
}

export async function getPaymentItem(id: string): Promise<PaymentItem | null> {
  const items = await getPaymentItems();
  const item = items.find((i) => i.id === id);
  return item && safePaymentUrl(item.url) ? item : null;
}
