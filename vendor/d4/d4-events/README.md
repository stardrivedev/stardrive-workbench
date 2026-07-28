# d4-events

An events calendar, managed from `/admin`.

- **Public page**: `/events`, upcoming first, with a "Previously" archive below.
- **Embeddable**: `<Events limit={3} title="What's on" />` from
  `@/modules/events/Events`. Renders nothing when nothing is upcoming, so a
  quiet month leaves no empty heading behind.
- **Admin panel**: title, date, optional last day for multi-day runs, optional
  start and end times, venue, address, price text, ticket link and an image.
- **Structured data**: `Event` markup for everything upcoming, with location
  and offers included only when the owner actually entered them.

Events move from upcoming to past by **calendar date**, not by instant, so an
event happening today stays listed all day rather than vanishing at midnight
UTC while the doors are still open.

Requires `d4-cms-core` for the admin shell, the data store and image uploads.

## Collection

`events`: `SiteEvent[]` (see `src/modules/events/types.ts`).
