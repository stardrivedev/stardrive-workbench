# d4-booking

Appointment booking, managed from `/admin`.

- **Public page**: `/book`. Pick a service, pick a day, pick from the times that
  are actually free, leave your details.
- **Admin panel**: three tabs. **Diary** (upcoming and past bookings, confirm or
  cancel), **Services** (name, length, optional price and description),
  **Hours** (timezone, working windows per weekday, slot spacing, lead time,
  booking horizon, and specific closed dates).
- **Email**: with `RESEND_API_KEY` and `CONTACT_TO_EMAIL` set, the owner is
  notified and the customer is confirmed. Without them, the booking is still
  stored and shown in the diary.

## The two things this module takes seriously

**Time zones.** A diary has one hard requirement: 10am means 10am where the
business is, in June and in December, whatever clock the server keeps. So
instants are stored in UTC and converted through the business's IANA zone at
both ends, using `Intl` and no date library (`src/modules/booking/time.ts`).
`zonedToUtc` runs two passes, because a single pass is wrong for appointments
on the far side of a daylight-saving change from today.

**Double booking.** The data store writes a whole collection at a time, so a
plain read-check-write leaves a window where two requests both see a free slot.
`POST /api/booking` therefore writes and then **re-reads**: if a rival for the
same slot appeared, exactly one wins by a rule both requests compute identically
(earliest `createdAt`, ties broken by id), and the loser withdraws itself and
returns `409`. The customer is told to pick another time instead of turning up
to a double-booked chair, and the picker reloads itself on that response.

A crafted request cannot book outside working hours either: the server
regenerates the slot list and requires an exact match before accepting.

## Honest limits

- The reconcile narrows the race to the gap between two reads; it does not make
  the write atomic. For a single-diary business this is the right trade. A
  business running many practitioners in parallel wants a real database
  constraint, which means extending `d4-cms-core`, not this module.
- Bookings inside the hour that repeats when clocks go back may resolve to
  either instance of that wall-clock time.
- No payment is taken. `price` is display text. See `d4-payments`.
- Cancelling sets a status rather than deleting, so the owner keeps the record.

Requires `d4-cms-core` for the admin shell and the data store.

## Collections

`booking-services`: `Service[]`. `booking-availability`: `AvailabilitySettings`.
`bookings`: `Booking[]`. See `src/modules/booking/types.ts`.
