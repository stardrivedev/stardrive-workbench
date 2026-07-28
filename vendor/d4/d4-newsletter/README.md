# d4-newsletter

Email capture with consent you can evidence, managed from `/admin`.

- **Embeddable**: `<SignupForm />` from `@/modules/newsletter/SignupForm`.
  Drop it on the home page, a footer area, or an article.
- **Public page**: `/unsubscribe`, reached from an emailed link. Excluded from
  search indexing.
- **Admin panel**: the subscriber list, a toggle between subscribed and
  unsubscribed, manual unsubscribe and delete, and CSV export.

## What this module deliberately does not do

**It does not send email.** It collects and holds the list, and exports it.
Sending belongs to whichever platform the owner already pays for, and a
half-built sender that silently drops mail would be worse than none.

## Consent, handled properly

- The consent box is **never pre-ticked**, and the submit button is disabled
  until it is ticked. The API rejects a request without it regardless, so the
  rule holds even if a form is embedded wrongly.
- The **exact wording shown** is stored on the subscriber, with a timestamp and
  the page it came from. Consent you cannot evidence is not consent.
- Unsubscribing sets a date rather than deleting the row, so a later re-import
  cannot quietly resurrect somebody who asked to be removed. Deleting outright
  is still available for an erasure request.
- Subscribing an address that is already on the list returns success **without
  saying so**. A different answer would turn the form into a way to test
  whether any given address is subscribed.
- Unsubscribe links carry a random 24-byte token, compared against the stored
  value. A link built from a guessed email address cannot remove anyone.

## CSV safety

`toCsv` quotes every field, doubles embedded quotes, and prefixes a leading
`=`, `+`, `-` or `@` with an apostrophe. Without that last step a crafted name
becomes a live formula the moment the export is opened in a spreadsheet.

Requires `d4-cms-core` for the admin shell and the data store.

## Collection

`subscribers`: `Subscriber[]` (see `src/modules/newsletter/types.ts`).
