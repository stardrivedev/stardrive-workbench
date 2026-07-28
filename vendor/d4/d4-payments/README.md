# d4-payments

Take real money, through Stripe Payment Links.

- **Public page**: `/pay`, a card per item with a Buy button.
- **Embeddable**: `<PayButton itemId="pay-abc" />` from
  `@/modules/payments/PayButton`, for a catalog product page, a class listing,
  a deposit request, anywhere. The admin panel prints the exact snippet for
  each item.
- **Admin panel**: name, display price, Stripe Payment Link, description,
  image, and a hide toggle.

## What this is, and what it deliberately is not

The owner creates a Payment Link in **their own Stripe dashboard** and pastes
it in. The customer pays on Stripe's hosted page and the money lands in the
owner's Stripe account.

That means **no API keys on the site, no webhook endpoint to secure, no card
data in scope, and nothing to reconcile**. It is a genuine way to sell.

It is **not** a shopping cart. There is no basket, no stock count, no order
history and no shipping calculation. A business that needs those needs a real
storefront, and pretending a link list is one would be the expensive kind of
lie. Refunds, receipts, tax and payouts are all handled in Stripe, which is
where the owner already has to look.

The **price charged is whatever the Stripe link says.** The price typed into
the editor is display text, and the panel says so, because the two drifting
apart is the obvious failure here.

## Safety

Owner-supplied URLs are rendered as an `href`, so `safePaymentUrl` accepts
**only plain https**. A `javascript:` URL pasted into the editor would
otherwise run as script for every visitor who clicked Buy. The rule is enforced
in the server action too, not just in the browser, and an item that fails it is
dropped from the page rather than shown with a dead button.

Links are checked against Stripe's own hosts and the editor flags anything
else. It is a warning, not a block, because Stripe supports custom checkout
domains.

Buy links carry `rel="noopener noreferrer"`: the destination is a payment page,
and a new tab holding a handle on the opener is a real phishing route.

Requires `d4-cms-core` for the admin shell and the data store.

## Collection

`payment-items`: `PaymentItem[]` (see `src/modules/payments/types.ts`).
