/**
 * Fact-driven module seeds: the path from what the operator typed to what the
 * built site opens with, for the material the AI must never touch.
 *
 * The hours parser gets the most attention here, because it is the one piece
 * that can send a real person to a locked door: it is all-or-nothing by
 * design, and these checks pin down exactly which shapes it accepts.
 *
 * Run: node services/api/test/seeds.mjs
 */
import assert from 'node:assert';
import {
  parseWeeklyHours,
  seedBookingServices,
  seedTestimonials,
  seedEvents,
  seedLocations,
  renderBookingSeed,
  renderTestimonialsSeed,
} from '../lib/seed.mjs';

let failures = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(
  () => console.log(`  ok    ${name}`),
  (e) => { failures++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
);

console.log('seeds:');

// ── Booking services ──
await check('services keep the operator\'s exact names and lengths', () => {
  const out = seedBookingServices({
    bookableServices: [
      { name: 'Cut and finish', minutes: '45', price: '£38' },
      { name: 'Colour', minutes: '90 mins', price: '' },
    ],
  });
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].name, 'Cut and finish');
  assert.strictEqual(out[0].durationMin, 45);
  assert.strictEqual(out[0].price, '£38');
  assert.strictEqual(out[1].durationMin, 90, 'a stray "mins" does not defeat the number');
  assert.strictEqual('price' in out[1], false, 'no price typed means no price shown');
});

await check('a service with no length is still bookable, at an hour', () => {
  const out = seedBookingServices({ bookableServices: [{ name: 'Consultation' }] });
  assert.strictEqual(out[0].durationMin, 60);
});

await check('nameless rows are dropped, and duplicate names get distinct ids', () => {
  const out = seedBookingServices({
    bookableServices: [{ name: '' }, { name: 'Massage' }, { name: 'Massage' }],
  });
  assert.strictEqual(out.length, 2);
  assert.notStrictEqual(out[0].id, out[1].id);
});

// ── The hours parser ──
await check('"Mon-Fri 9-5" becomes a five-day week ending at 5pm', () => {
  const w = parseWeeklyHours('Mon-Fri 9-5');
  assert.deepStrictEqual(w.map((x) => x.day), [1, 2, 3, 4, 5]);
  assert.strictEqual(w[0].start, '09:00');
  assert.strictEqual(w[0].end, '17:00', 'a bare closing 5 is the afternoon, not dawn');
});

await check('am/pm and 24-hour forms both work', () => {
  assert.strictEqual(parseWeeklyHours('Mon-Fri 9am-5:30pm')[0].end, '17:30');
  assert.strictEqual(parseWeeklyHours('Mon-Fri 09:00-17:00')[0].end, '17:00');
  assert.strictEqual(parseWeeklyHours('Monday to Friday 8 to 4')[0].start, '08:00');
});

await check('several segments combine, and a wrapping range crosses the weekend', () => {
  const w = parseWeeklyHours('Mon-Fri 9-5, Sat 10-2');
  assert.strictEqual(w.length, 6);
  assert.strictEqual(w.find((x) => x.day === 6).end, '14:00');
  assert.deepStrictEqual(parseWeeklyHours('Fri-Mon 10-4').map((x) => x.day), [5, 6, 0, 1]);
});

await check('anything it does not genuinely understand returns null, not a guess', () => {
  for (const bad of [
    'by appointment only',
    'Mon-Fri 9-5 except bank holidays',
    'weekdays 9-5',
    'Mon-Fri 5-9pm, and some Saturdays',
    'Mon 25-99',
    '',
    null,
  ]) {
    assert.strictEqual(parseWeeklyHours(bad), null, `should refuse: ${JSON.stringify(bad)}`);
  }
});

await check('one unparseable segment discards the whole week', () => {
  // Half a diary is more dangerous than none: the missing half reads as closed.
  assert.strictEqual(parseWeeklyHours('Mon-Fri 9-5, and Sundays sometimes'), null);
});

await check('a closing time at or before opening is refused', () => {
  assert.strictEqual(parseWeeklyHours('Mon 17:00-09:00'), null);
  assert.strictEqual(parseWeeklyHours('Mon 11am-9am'), null);
  assert.strictEqual(parseWeeklyHours('Mon 09:00-09:00'), null);
});

await check('a bare closing hour reads as the afternoon, but an opening one does not', () => {
  // "9-5" is the commonest way hours get written, and 9am-5pm is what it
  // means. "5-5" is a real early-opening bakery, not an error to reject.
  assert.strictEqual(parseWeeklyHours('Mon 9-5')[0].end, '17:00');
  assert.deepStrictEqual(parseWeeklyHours('Mon 5-5')[0], { day: 1, start: '05:00', end: '17:00' });
});

// ── Booking availability ──
await check('availability carries timezone and notice, and omits hours it could not read', () => {
  const src = renderBookingSeed(null, {
    bookableServices: [{ name: 'Trim', minutes: '30' }],
    bookingTimezone: 'Europe/London',
    workingHours: 'by appointment',
    bookingNotice: '24 hours',
  });
  const availability = JSON.parse(src.slice(src.indexOf('seedAvailability: Partial<AvailabilitySettings> = ') + 49, src.lastIndexOf(';')));
  assert.strictEqual(availability.timezone, 'Europe/London');
  assert.strictEqual(availability.leadTimeHours, 24);
  assert.strictEqual('windows' in availability, false, 'unreadable hours leave the module default in place');
});

await check('"same day" means no lead time at all', () => {
  const src = renderBookingSeed(null, { bookableServices: [], bookingNotice: 'same day' });
  assert.match(src, /"leadTimeHours": 0/);
});

// ── Testimonials ──
await check('testimonials are verbatim and are never given a rating', () => {
  const out = seedTestimonials({
    testimonials: [{ quote: 'They were brilliant, start to finish.', author: 'Dana R', role: 'Leeds' }],
  });
  assert.strictEqual(out[0].quote, 'They were brilliant, start to finish.');
  assert.strictEqual(out[0].author, 'Dana R');
  assert.strictEqual('rating' in out[0], false, 'a score nobody gave is a fabricated endorsement');
});

await check('a quote with no attribution is dropped rather than published anonymously', () => {
  assert.strictEqual(seedTestimonials({ testimonials: [{ quote: 'Great!' }] }).length, 0);
  assert.strictEqual(seedTestimonials({ testimonials: [{ author: 'Sam' }] }).length, 0);
});

await check('the rendered testimonials seed is valid TypeScript source', () => {
  const src = renderTestimonialsSeed(null, { testimonials: [{ quote: 'Lovely.', author: 'Pat' }] });
  assert.match(src, /export const seedTestimonials: Testimonial\[\] = \[/);
  assert.match(src, /"author": "Pat"/);
});

// ── Events ──
await check('events need a real ISO date, or they are left out', () => {
  const out = seedEvents({
    events: [
      { title: 'Summer social', date: '2026-08-15', note: 'The garden' },
      { title: 'Vague thing', date: 'sometime in August' },
    ],
  });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].venue, 'The garden');
});

// ── Locations ──
await check('the contact facts become one location, address kept whole', () => {
  const [loc] = seedLocations({
    address: '12 High Street, Otley, LS21 1AA',
    phone: '01943 000000',
    contactEmail: 'hello@example.com',
    locationTimezone: 'Europe/London',
    locationCoords: '53.9048, -1.6931',
    hours: 'Mon-Fri 9-5',
  }, 'Otley Bakes');
  assert.strictEqual(loc.name, 'Otley Bakes');
  assert.strictEqual(loc.address.street, '12 High Street, Otley, LS21 1AA', 'not split into guessed parts');
  assert.strictEqual(loc.lat, 53.9048);
  assert.strictEqual(loc.timezone, 'Europe/London');
  assert.strictEqual(loc.hours.length, 5);
  assert.strictEqual(loc.hours[0].opens, '09:00');
});

await check('no address and no name seeds nothing at all', () => {
  assert.deepStrictEqual(seedLocations({}, ''), []);
});

await check('malformed coordinates are ignored rather than placing a wrong pin', () => {
  const [loc] = seedLocations({ address: 'Somewhere', locationCoords: 'near the church' }, 'X');
  assert.strictEqual('lat' in loc, false);
});

if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll seed checks passed.');
