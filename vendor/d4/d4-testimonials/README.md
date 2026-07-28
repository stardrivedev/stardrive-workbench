# d4-testimonials

Customer testimonials, managed from `/admin`.

- **Public page**: `/testimonials`, every testimonial, newest first.
- **Embeddable**: `<Testimonials limit={3} title="What our clients say" />` from
  `@/modules/testimonials/Testimonials`. It renders **nothing** when there are
  no testimonials, so a page that embeds it does not grow an empty heading on a
  brand new site.
- **Admin panel**: quote, author, optional role, optional 1 to 5 rating,
  optional uploaded photo, and a "featured" flag that controls whether an entry
  appears in embedded strips.
- **Structured data**: an `AggregateRating` is emitted **only** when real
  ratings exist. Zero reviews produces no aggregate rather than a score of
  zero, and an unrated testimonial never becomes an invented five stars.

Requires `d4-cms-core` for the admin shell, the data store and image uploads.

## Collection

`testimonials`: `Testimonial[]` (see `src/modules/testimonials/types.ts`).
