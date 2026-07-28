import { getPaymentItem } from "./data";
import { safePaymentUrl } from "./types";

/**
 * A Buy button for one payment item, embeddable anywhere:
 *   <PayButton itemId="pay-abc" />
 *   <PayButton itemId="pay-abc" label="Pay deposit" />
 *
 * Renders nothing when the item is missing or its URL is not a plain https
 * address. A button that goes nowhere costs a sale and the owner's confidence,
 * so silence is the better failure.
 *
 * `rel="noopener"` matters here: the destination is a payment page, and a new
 * tab that keeps a handle on the opener is a real phishing route.
 */
export default async function PayButton({
  itemId,
  label,
  className,
}: {
  itemId: string;
  label?: string;
  className?: string;
}) {
  const item = await getPaymentItem(itemId);
  const href = item && safePaymentUrl(item.url);
  if (!item || !href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        "inline-block rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-strong"
      }
    >
      {label ?? (item.price ? `Buy for ${item.price}` : `Buy ${item.name}`)}
    </a>
  );
}
