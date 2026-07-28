# d4-locations

Addresses, opening hours and local SEO, managed from `/admin`.

- **Public page**: `/locations`, one card per location.
- **Embeddable**: `<Locations limit={1} />` from `@/modules/locations/Locations`,
  for a contact page. Renders nothing when no location exists.
- **Admin panel**: name, full postal address, phone, email, timezone,
  per-day opening hours, optional coordinates, and free-text notes for parking
  or accessibility.

## Why this module earns its place

`LocalBusiness` structured data with `openingHoursSpecification` is what lets a
search engine show hours, a phone number and a map pin instead of a plain blue
link. It is invisible to the site owner and it is usually the difference
between being found locally and not.

## Deliberate limits

- **No map API key.** The embed is OpenStreetMap, which needs no account and no
  billing. Directions use Google's documented universal maps URL, which opens
  the native app on a phone. Neither requires the owner to sign up for
  anything.
- **No pin without coordinates.** With no latitude and longitude the page shows
  the address and a directions link rather than an approximate marker.
- **No "Open now" without a timezone.** `isOpenNow()` returns `null` rather
  than guessing, and the indicator is hidden. A wrong "Open now" sends someone
  to a locked door, which is worse than saying nothing.
- Closing times earlier than opening times are treated as running past
  midnight, so late-night venues read correctly.

Requires `d4-cms-core` for the admin shell and the data store.

## Collection

`locations`: `Location[]` (see `src/modules/locations/types.ts`).
