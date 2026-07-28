/**
 * Feature-module seeds: turn the AI content pack (copy-gen) into the initial
 * rows for each feature module's CMS collection, so a freshly built site's
 * feature pages (careers, catalog, insights) open with real content instead of
 * an empty state. Each module ships an empty `src/config/<mod>.generated.ts`
 * default (so it compiles standalone) and reads it as the `readCollection`
 * fallback; Stardrive overwrites that file at assembly with these seeds. The
 * DB always wins once the owner edits in /admin — this is only the starting point.
 *
 * Deterministic: the same pack in yields the same rows out (ids are slugs of the
 * title, de-duplicated), so a rebuild never churns the seed.
 */

const today = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

function slugify(s, i) {
  const base = String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || `item-${i + 1}`;
}

/** Make a list of ids unique (append -2, -3, … on collision). */
function uniqueIds(ids) {
  const seen = new Map();
  return ids.map((id) => {
    const n = (seen.get(id) || 0) + 1;
    seen.set(id, n);
    return n === 1 ? id : `${id}-${n}`;
  });
}

/** pack.careers.roles [{title, summary}] → Job[] */
export function seedJobsFromPack(pack, { date = today() } = {}) {
  const roles = (pack?.careers?.roles || []).filter((r) => r && String(r.title || '').trim());
  const ids = uniqueIds(roles.map((r, i) => slugify(r.title, i)));
  return roles.map((r, i) => ({
    id: ids[i],
    title: String(r.title).trim(),
    type: 'Full-Time',
    location: '',
    description: String(r.summary || '').trim(),
    requirements: [],
    postedAt: date,
  }));
}

/** pack.store.products [{name, price, description}] → { products: Product[], categories: CatalogCategory[] } */
export function seedCatalogFromPack(pack) {
  const items = (pack?.store?.products || []).filter((p) => p && String(p.name || '').trim());
  if (!items.length) return { products: [], categories: [] };
  const categories = [{ id: 'all', label: 'Products', description: '' }];
  const ids = uniqueIds(items.map((p, i) => slugify(p.name, i)));
  const products = items.map((p, i) => ({
    id: ids[i],
    title: String(p.name).trim(),
    category: 'all',
    description: String(p.description || '').trim(),
    specs: String(p.price || '').trim() ? [{ label: 'Price', value: String(p.price).trim() }] : [],
  }));
  return { products, categories };
}

/** pack.blog.posts [{title, excerpt, body}] → Article[] */
export function seedArticlesFromPack(pack, { date = today() } = {}) {
  const posts = (pack?.blog?.posts || []).filter((p) => p && String(p.title || '').trim());
  const ids = uniqueIds(posts.map((p, i) => slugify(p.title, i)));
  return posts.map((p, i) => ({
    id: ids[i],
    title: String(p.title).trim(),
    subtitle: String(p.excerpt || '').trim(),
    date,
    body: String(p.body || '').trim(),
    tags: [],
  }));
}

const banner = `/**
 * GENERATED FILE. Written by Stardrive at assembly from the AI-written content,
 * the initial rows this feature page opens with. Edits in /admin override these
 * (a saved collection wins). Do not edit by hand; overwritten on reassembly.
 */`;

/** The `src/config/careers.generated.ts` source for a site. */
export function renderCareersSeed(pack) {
  const jobs = seedJobsFromPack(pack);
  return `${banner}\nimport type { Job } from "@/modules/careers/types";\n\nexport const seedJobs: Job[] = ${JSON.stringify(jobs, null, 2)};\n`;
}

/** The `src/config/catalog.generated.ts` source for a site. */
export function renderCatalogSeed(pack) {
  const { products, categories } = seedCatalogFromPack(pack);
  return `${banner}\nimport type { Product, CatalogCategory } from "@/modules/catalog/types";\n\nexport const seedCategories: CatalogCategory[] = ${JSON.stringify(categories, null, 2)};\n\nexport const seedProducts: Product[] = ${JSON.stringify(products, null, 2)};\n`;
}

/** The `src/config/insights.generated.ts` source for a site. */
export function renderInsightsSeed(pack) {
  const articles = seedArticlesFromPack(pack);
  return `${banner}\nimport type { Article } from "@/modules/insights/types";\n\nexport const seedArticles: Article[] = ${JSON.stringify(articles, null, 2)};\n`;
}

// ── Fact-driven seeds ────────────────────────────────────────────────────
//
// The seeds above turn AI-written copy into starting rows. The ones below take
// the operator's RAW FACTS instead, because for this material the AI must not
// be in the loop at all: a testimonial has to be what the customer actually
// said, an appointment length has to be the real one, and an address has to be
// the real address. These seed correctly with the model switched off entirely.

const trim = (v) => String(v ?? '').trim();
const rows = (facts, id) => (Array.isArray(facts?.[id]) ? facts[id] : []);

/** facts.bookableServices [{name, minutes, price}] → Service[] */
export function seedBookingServices(facts) {
  const items = rows(facts, 'bookableServices').filter((r) => trim(r?.name));
  const ids = uniqueIds(items.map((r, i) => slugify(r.name, i)));
  return items.map((r, i) => {
    const minutes = parseInt(String(r.minutes ?? '').replace(/[^\d]/g, ''), 10);
    return {
      id: ids[i],
      name: trim(r.name),
      // A service with no stated length still has to be bookable; an hour is
      // the ordinary default and the owner can change it in the dashboard.
      durationMin: Number.isFinite(minutes) && minutes >= 5 ? minutes : 60,
      ...(trim(r.price) ? { price: trim(r.price) } : {}),
    };
  });
}

const DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DAY_RE = /^(sun|mon|tue|wed|thu|fri|sat)/;

/** "9", "9am", "17:30", "5pm" → "HH:MM", or null when it is not a time. */
function parseClock(raw, assumePm = false) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(trim(raw));
  if (!m) return null;
  let h = Number(m[1]);
  const mins = m[2] ? Number(m[2]) : 0;
  const suffix = m[3]?.toLowerCase();
  if (h > 23 || mins > 59) return null;
  if (suffix === 'pm' && h < 12) h += 12;
  else if (suffix === 'am' && h === 12) h = 0;
  // "Mon-Fri 9-5" means 5pm. Bare closing hours below 8 read as afternoon.
  else if (!suffix && assumePm && h < 8) h += 12;
  return `${String(h).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * "Mon-Fri 9-5, Sat 10-2" → weekly windows, or null.
 *
 * Deliberately all-or-nothing: a diary half-parsed from prose takes bookings
 * at hours the business is shut, and somebody arrives to a locked door. If any
 * segment does not fit this narrow grammar, the caller keeps the module's own
 * default and the owner confirms the week in the dashboard.
 */
export function parseWeeklyHours(text) {
  const source = trim(text).toLowerCase().replace(/–|—/g, '-');
  if (!source) return null;
  const windows = [];
  for (const segment of source.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^([a-z]+)(?:\s*(?:-|to)\s*([a-z]+))?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i.exec(segment);
    if (!m) return null;
    const from = DAY_RE.exec(m[1]);
    if (!from) return null;
    const start = DAY_INDEX[from[1]];
    let end = start;
    if (m[2]) {
      const to = DAY_RE.exec(m[2]);
      if (!to) return null;
      end = DAY_INDEX[to[1]];
    }
    const opens = parseClock(m[3]);
    const closes = parseClock(m[4], true);
    if (!opens || !closes || closes <= opens) return null;
    // Walk forward so "Fri-Mon" wraps the weekend rather than producing nothing.
    for (let d = start, guard = 0; guard < 7; guard += 1) {
      windows.push({ day: d, start: opens, end: closes });
      if (d === end) break;
      d = (d + 1) % 7;
    }
  }
  return windows.length ? windows : null;
}

/** The `src/config/booking.generated.ts` source. */
export function renderBookingSeed(pack, facts) {
  const services = seedBookingServices(facts);
  const availability = {};
  const tz = trim(facts?.bookingTimezone);
  if (tz) availability.timezone = tz;
  const windows = parseWeeklyHours(facts?.workingHours);
  if (windows) availability.windows = windows;
  const notice = trim(facts?.bookingNotice).toLowerCase();
  if (/same\s*day|immediate/.test(notice)) availability.leadTimeHours = 0;
  else {
    const hrs = /(\d+)\s*hour/.exec(notice);
    const days = /(\d+)\s*day/.exec(notice);
    if (hrs) availability.leadTimeHours = Number(hrs[1]);
    else if (days) availability.leadTimeHours = Number(days[1]) * 24;
  }
  return `${banner}\nimport type { AvailabilitySettings, Service } from "@/modules/booking/types";\n\nexport const seedServices: Service[] = ${JSON.stringify(services, null, 2)};\n\n/** Partial: merged over DEFAULT_AVAILABILITY, then over anything stored. */\nexport const seedAvailability: Partial<AvailabilitySettings> = ${JSON.stringify(availability, null, 2)};\n`;
}

/** facts.testimonials [{quote, author, role}] → Testimonial[], verbatim. */
export function seedTestimonials(facts, { date = today() } = {}) {
  const items = rows(facts, 'testimonials').filter((r) => trim(r?.quote) && trim(r?.author));
  const ids = uniqueIds(items.map((r, i) => slugify(r.author, i)));
  return items.map((r, i) => ({
    id: ids[i],
    quote: trim(r.quote),
    author: trim(r.author),
    ...(trim(r.role) ? { role: trim(r.role) } : {}),
    date,
    featured: true,
    // No rating is seeded, ever. The operator typed a quote, not a score, and
    // inventing five stars on someone's behalf is a fabricated endorsement.
  }));
}

export function renderTestimonialsSeed(pack, facts) {
  return `${banner}\nimport type { Testimonial } from "@/modules/testimonials/types";\n\nexport const seedTestimonials: Testimonial[] = ${JSON.stringify(seedTestimonials(facts), null, 2)};\n`;
}

/** facts.events [{title, date, note}] → SiteEvent[]. */
export function seedEvents(facts) {
  const items = rows(facts, 'events').filter((r) => trim(r?.title) && /^\d{4}-\d{2}-\d{2}$/.test(trim(r?.date)));
  const ids = uniqueIds(items.map((r, i) => slugify(r.title, i)));
  return items.map((r, i) => ({
    id: ids[i],
    title: trim(r.title),
    date: trim(r.date),
    ...(trim(r.note) ? { venue: trim(r.note) } : {}),
  }));
}

export function renderEventsSeed(pack, facts) {
  return `${banner}\nimport type { SiteEvent } from "@/modules/events/types";\n\nexport const seedEvents: SiteEvent[] = ${JSON.stringify(seedEvents(facts), null, 2)};\n`;
}

/** The contact facts, as one location. */
export function seedLocations(facts, siteName = '') {
  const address = trim(facts?.address);
  const name = trim(facts?.locationName) || trim(siteName);
  if (!address && !name) return [];
  const coords = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(trim(facts?.locationCoords));
  const windows = parseWeeklyHours(facts?.hours);
  return [{
    id: 'main',
    name: name || 'Main location',
    // The address is kept as one line rather than split into street/city/
    // postcode: guessing which part is which produces a wrong postal address,
    // and the owner can separate them in the dashboard.
    address: { street: address || undefined },
    ...(trim(facts?.phone) ? { phone: trim(facts.phone) } : {}),
    ...(trim(facts?.contactEmail) ? { email: trim(facts.contactEmail) } : {}),
    ...(trim(facts?.locationTimezone) ? { timezone: trim(facts.locationTimezone) } : {}),
    ...(coords ? { lat: Number(coords[1]), lng: Number(coords[2]) } : {}),
    ...(trim(facts?.locationNotes) ? { notes: trim(facts.locationNotes) } : {}),
    hours: (windows || []).map((w) => ({ day: w.day, opens: w.start, closes: w.end })),
  }];
}

export function renderLocationsSeed(pack, facts, siteName) {
  return `${banner}\nimport type { Location } from "@/modules/locations/types";\n\nexport const seedLocations: Location[] = ${JSON.stringify(seedLocations(facts, siteName), null, 2)};\n`;
}

/**
 * Which module → which generated seed file + renderer.
 *
 * `render(pack, facts, siteName)`. Seeds marked `needsFacts` run even with no
 * AI pack at all, because their source is what the operator typed, not
 * anything a model wrote.
 */
export const MODULE_SEEDS = {
  'd4-careers-portal': { file: 'src/config/careers.generated.ts', render: renderCareersSeed },
  'd4-catalog': { file: 'src/config/catalog.generated.ts', render: renderCatalogSeed },
  'd4-insights-blog': { file: 'src/config/insights.generated.ts', render: renderInsightsSeed },
  'd4-booking': { file: 'src/config/booking.generated.ts', render: renderBookingSeed, needsFacts: true },
  'd4-testimonials': { file: 'src/config/testimonials.generated.ts', render: renderTestimonialsSeed, needsFacts: true },
  'd4-events': { file: 'src/config/events.generated.ts', render: renderEventsSeed, needsFacts: true },
  'd4-locations': { file: 'src/config/locations.generated.ts', render: renderLocationsSeed, needsFacts: true },
};
