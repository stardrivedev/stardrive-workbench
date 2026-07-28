export interface PaymentItem {
  id: string;
  name: string;
  description?: string;
  /** Display text, not a number: "£40", "from $25", "50% deposit". The real
   *  amount charged is whatever the Stripe link says, and Stripe is the only
   *  place it can be set. */
  price?: string;
  /** A Stripe Payment Link, created in the owner's own dashboard. */
  url: string;
  image?: string;
  /** Off the /pay page without deleting the item. */
  hidden?: boolean;
}

/**
 * Stripe's own payment-link hosts. A link on another host is not rejected,
 * because Stripe supports custom checkout domains, but the editor says so:
 * a payment button pointing somewhere unexpected is worth a second look.
 */
export const STRIPE_HOSTS = ["buy.stripe.com", "checkout.stripe.com"];

/**
 * Owner-supplied URLs end up in an href, so anything that is not plain https
 * is refused outright. Without this, a `javascript:` URL pasted into the
 * editor would run as script for every visitor who clicked Buy.
 */
export function safePaymentUrl(raw: string): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Is this a link on one of Stripe's own hosts? Advisory, not a gate. */
export function isStripeHost(raw: string): boolean {
  try {
    return STRIPE_HOSTS.includes(new URL(raw).hostname);
  } catch {
    return false;
  }
}
