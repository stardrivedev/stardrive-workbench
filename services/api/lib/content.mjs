/**
 * Content model — the deterministic intake that makes a site DONE, not DIY.
 *
 * The old flow captured a name, a style, and which feature modules to include,
 * so every real word on the site fell back to placeholder filler. This module
 * defines the FACTS a site needs, gated by the pages/features chosen: only what
 * the selected pages actually require, nothing more. The operator answers short
 * factual questions; the AI (see copy-gen.mjs) turns those facts into finished
 * copy. Build is gated on `readiness(...).ready` so a half-empty site can never
 * ship.
 *
 * Facts are stored per-site under site.content as a flat object keyed by field
 * id. Values by kind:
 *   line/email/tel/address/hours/facts → string
 *   list/topics                        → string[]
 *   people                             → { name, role }[]
 *   roles                              → { title, summary }[]
 *   products                           → { name, price, note }[]
 *   photos                             → satisfied by an upload in a compartment
 */

export const GROUP_LABELS = {
  identity: 'The basics',
  about: 'About the business',
  offerings: 'What you offer',
  contact: 'How to reach you',
  team: 'Your team',
  faq: 'Common questions',
  social: 'Social links',
  careers: 'Careers',
  store: 'Products',
  blog: 'Articles',
  gallery: 'Gallery',
  booking: 'Booking',
  locations: 'Location and hours',
  testimonials: 'Testimonials',
  events: 'Events',
  menu: 'Menu',
  newsletter: 'Newsletter',
  legal: 'Legal pages',
};

// Content every site needs (the base template always ships home/about/contact).
const ALWAYS = [
  { id: 'whatYouDo', group: 'identity', label: 'What does the business do?', kind: 'line', required: true,
    help: 'One plain sentence. The AI turns this into your headline and tagline.',
    clientHelp: 'One plain sentence. This becomes the headline on your home page.' },
  { id: 'aboutFacts', group: 'about', label: 'A few facts about the business', kind: 'facts', required: true,
    help: 'Notes are fine: when it started, the story so far, how you work. The AI writes the About page from these.',
    clientHelp: 'Notes are fine, no need for full sentences: when it started, the story so far, how you like to work. Your About page is written from these.' },
  { id: 'mission', group: 'about', label: 'Mission or the difference you make', kind: 'line', required: false,
    help: 'One sentence. Highlighted on the About page.' },
  { id: 'whoYouServe', group: 'about', label: 'Who you serve', kind: 'line', required: false,
    help: 'Your ideal customers or audience, e.g. "busy families" or "B2B manufacturers".' },
  { id: 'differentiator', group: 'about', label: 'What makes you different', kind: 'line', required: false,
    help: 'The main reason customers choose you over the alternatives.' },
  { id: 'services', group: 'offerings', label: 'Main services or offerings', kind: 'list', required: true,
    help: 'List the handful of things you offer. The AI writes a short description for each.',
    clientHelp: 'List the handful of things you offer, one per line. Each one gets a short description written for it.' },
  { id: 'contactEmail', group: 'contact', label: 'Contact email', kind: 'email', required: true,
    help: 'Where enquiries should go. Shown on the contact page and footer.' },
  { id: 'phone', group: 'contact', label: 'Phone', kind: 'tel', required: false },
  { id: 'address', group: 'contact', label: 'Address', kind: 'address', required: false },
  { id: 'hours', group: 'contact', label: 'Opening hours', kind: 'hours', required: false,
    help: 'e.g. "Mon–Fri 9–5, closed weekends".' },
  { id: 'team', group: 'team', label: 'Team members', kind: 'people', required: false,
    help: 'Name and role for each person to feature. The AI writes a short bio.',
    clientHelp: 'Name and role for anyone you would like on the site. A short introduction is written for each of them.' },
  { id: 'faqTopics', group: 'faq', label: 'Common questions', kind: 'list', required: false,
    help: 'List questions customers ask; the AI writes clear answers.',
    clientHelp: 'The questions customers actually ask you. Clear answers are written for each one.' },
  { id: 'socials', group: 'social', label: 'Social links', kind: 'list', required: false,
    help: 'Full URLs, one per profile.' },
];

// Extra required content unlocked by a chosen feature module.
const MODULE_FIELDS = {
  'd4-careers-portal': [
    { id: 'roles', group: 'careers', label: 'Open roles', kind: 'roles', required: true,
      help: 'A title and one-line summary per role. The AI writes the full posting.',
      clientHelp: 'A job title and one line about it. The full advert is written from that.' },
  ],
  'd4-catalog': [
    { id: 'products', group: 'store', label: 'Products', kind: 'products', required: true,
      help: 'Name, price, and a short note per product. The AI writes the descriptions.',
      clientHelp: 'Name, price, and a short note for each item. The descriptions are written from these.' },
  ],
  'd4-insights-blog': [
    { id: 'articleTopics', group: 'blog', label: 'Article topics', kind: 'topics', required: true,
      help: 'A few topics to launch with. The AI drafts the opening posts.',
      clientHelp: 'A few subjects you would like to write about. The opening articles are drafted from them.' },
  ],
  // Gallery photos are NOT an intake requirement: they are uploaded in the
  // Photos step (the `gallery` asset compartment), encouraged but skippable, so
  // a gallery site is never blocked from building. An empty gallery hides its
  // grid until photos are added.

  // A booking diary that ships empty is a booking page nobody can book on, so
  // the services and the working week are both required. The timezone is not:
  // without it the module simply hides its "Open now" style claims rather than
  // guessing, and the owner can set it in the dashboard.
  'd4-booking': [
    { id: 'bookableServices', group: 'booking', label: 'What can be booked', kind: 'rows', required: true,
      columns: [{ key: 'name', label: 'Service' }, { key: 'minutes', label: 'Minutes' }, { key: 'price', label: 'Price' }],
      help: 'One per line. The length in minutes decides how the day is divided into slots.' },
    { id: 'workingHours', group: 'booking', label: 'Working hours', kind: 'hours', required: true,
      help: 'The hours appointments can be booked in, e.g. "Mon-Fri 9-5, Sat 10-2".' },
    { id: 'bookingTimezone', group: 'booking', label: 'Timezone', kind: 'line', required: false,
      help: 'e.g. "Europe/London". Times on the booking page are shown in this zone.' },
    { id: 'bookingNotice', group: 'booking', label: 'Shortest notice you accept', kind: 'line', required: false,
      help: 'e.g. "same day" or "24 hours". Stops a 9:01am booking for 9:05am.' },
  ],

  // The address and hours already live in the contact group; what this module
  // additionally needs is the timezone (for a truthful open/closed indicator)
  // and, optionally, coordinates for the map.
  'd4-locations': [
    { id: 'locationName', group: 'locations', label: 'Location name', kind: 'line', required: false,
      help: 'Only needed if it differs from the business name, or you have more than one site.' },
    { id: 'locationTimezone', group: 'locations', label: 'Timezone', kind: 'line', required: false,
      help: 'e.g. "Europe/London". Without it the site will not claim you are open or closed.' },
    { id: 'locationCoords', group: 'locations', label: 'Map coordinates', kind: 'line', required: false,
      help: 'Latitude and longitude, e.g. "51.5074, -0.1278". Without them the page shows the address and a directions link instead of a map.' },
    { id: 'locationNotes', group: 'locations', label: 'Parking, entrance, access', kind: 'line', required: false,
      help: 'Anything that helps someone actually find the door.' },
  ],

  // Real quotes from real customers, or nothing. There is no version of this
  // where the AI writes the reviews.
  'd4-testimonials': [
    { id: 'testimonials', group: 'testimonials', label: 'Customer testimonials', kind: 'rows', required: false,
      columns: [{ key: 'quote', label: 'What they said' }, { key: 'author', label: 'Who' }, { key: 'role', label: 'Role or town' }],
      help: 'Only real quotes from real customers. Leave blank and add them in the dashboard later.' },
  ],

  'd4-events': [
    { id: 'events', group: 'events', label: 'Events to launch with', kind: 'rows', required: false,
      columns: [{ key: 'title', label: 'Event' }, { key: 'date', label: 'Date' }, { key: 'note', label: 'Venue or note' }],
      help: 'One per line, dates as YYYY-MM-DD. Leave blank and add them in the dashboard later.' },
  ],

  // Deliberately free text. A menu pasted as-is keeps the owner's own wording,
  // and dietary markers are set in the dashboard where a person confirms them,
  // never inferred from prose.
  'd4-menu': [
    { id: 'menuText', group: 'menu', label: 'Your menu', kind: 'facts', required: false,
      help: 'Paste it in, however it is written. Courses, dishes and prices are structured in the dashboard, where you confirm any dietary markers yourself.' },
    { id: 'menuServedWhen', group: 'menu', label: 'When it is served', kind: 'line', required: false,
      help: 'e.g. "Lunch 12-3, dinner 6-10, Tuesday to Sunday".' },
  ],

  'd4-newsletter': [
    { id: 'newsletterPitch', group: 'newsletter', label: 'What subscribers get', kind: 'line', required: false,
      help: 'e.g. "A monthly note about new arrivals". Shown above the signup form.' },
  ],

  // These fill the [square brackets] in the shipped drafts. Every one of them
  // is a fact only the owner has, and every draft stays unpublished until a
  // person reviews it regardless of what is answered here.
  'd4-legal': [
    { id: 'legalEntity', group: 'legal', label: 'Registered business name', kind: 'line', required: false,
      help: 'The legal name, if it differs from the trading name. Used in the privacy policy and terms.' },
    { id: 'legalJurisdiction', group: 'legal', label: 'Country or state you operate in', kind: 'line', required: false,
      help: 'Decides which rules the drafts should point at. Your adviser still has the final say.' },
    { id: 'legalContact', group: 'legal', label: 'Address for privacy requests', kind: 'line', required: false,
      help: 'Where someone writes to ask for a copy of their data, or its deletion.' },
    { id: 'legalRetention', group: 'legal', label: 'How long you keep enquiries', kind: 'line', required: false,
      help: 'e.g. "two years", or "six years for anything with an invoice attached".' },
  ],

  // d4-payments asks nothing. A Stripe Payment Link can only be created inside
  // the owner's own Stripe dashboard, so there is nothing an intake could
  // collect and nothing that could responsibly be invented.
};

/** The exact fields this site must/should answer, given its feature modules. */
export function requirementsFor(modules = []) {
  const set = new Set(modules || []);
  const fields = [...ALWAYS];
  for (const [mod, extra] of Object.entries(MODULE_FIELDS)) {
    if (set.has(mod)) fields.push(...extra);
  }
  return fields;
}

/**
 * The same questions, worded for the CLIENT rather than the licensee.
 *
 * The default help text explains the machinery ("the AI writes the About page
 * from these"), which is the right thing to tell a licensee and the wrong
 * thing to put in front of the business owner filling the form in: it is not
 * their concern, and plenty of people would rather not be told a machine is
 * writing about their family bakery. Where a field has a client wording it is
 * used; where it does not, the plain instruction was already fine for both.
 */
export function clientRequirementsFor(modules = []) {
  return requirementsFor(modules).map(({ clientHelp, ...field }) => ({
    ...field,
    ...(clientHelp ? { help: clientHelp } : {}),
  }));
}

/** The empty content pack — every section present, nothing filled. Templates
 *  render from this shape and hide sections that are empty. */
export function emptyContent() {
  return {
    tagline: '', description: '',
    home: { heroHeadline: '', heroSubhead: '', ctaLabel: '', introHeading: '', introBody: '' },
    about: { heading: '', paragraphs: [], mission: '' },
    services: [],
    contact: { heading: '', intro: '' },
    faq: [], team: [], careers: null, store: null, blog: null,
  };
}

/** The `content.generated.ts` module source — the CONTENT CONTRACT every
 *  template renders its page bodies from (analogous to assets.generated.ts).
 *  Stardrive writes it at assembly with the real pack; templates ship a default
 *  so they compile standalone. */
export function renderContentModule(pack) {
  const base = emptyContent();
  const c = {
    ...base, ...(pack || {}),
    home: { ...base.home, ...(pack?.home || {}) },
    about: { ...base.about, ...(pack?.about || {}) },
    contact: { ...base.contact, ...(pack?.contact || {}) },
  };
  return `/**
 * GENERATED FILE. The site's finished copy, written by Stardrive from the
 * owner's intake answers. Templates render every page body from \`siteContent\`
 * (with graceful fallbacks); empty sections hide. Do not edit; overwritten.
 */
export interface SiteContent {
  tagline: string;
  description: string;
  home: { heroHeadline: string; heroSubhead: string; ctaLabel: string; introHeading: string; introBody: string };
  about: { heading: string; paragraphs: string[]; mission: string };
  services: { name: string; description: string }[];
  contact: { heading: string; intro: string };
  faq: { question: string; answer: string }[];
  team: { name: string; role: string; bio: string }[];
  careers: { heading: string; intro: string; roles: { title: string; summary: string }[] } | null;
  store: { heading: string; intro: string; products: { name: string; price: string; description: string }[] } | null;
  blog: { heading: string; intro: string; posts: { title: string; excerpt: string; body: string }[] } | null;
  // A template may reference optional sections that aren't always provided
  // (e.g. testimonials, pricing). Keep the type permissive so a build never
  // fails on an unknown content field; an absent one resolves to undefined and
  // the section hides.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export const siteContent: SiteContent = ${JSON.stringify(c, null, 2)};
`;
}

/** Unambiguous filler phrases that must never survive into a shipped site.
 *  Multi-word so they can't hit legitimate `placeholder=` input attributes. */
export const PLACEHOLDER_PHRASES = [
  'Replace this',
  'Replace these',
  'sample stories with real',
  'Project image placeholder',
  'Lorem ipsum',
  'two or three sentences about the business',
  'clear, direct statement of what this business does',
  'space is ready for a concise',
  'Summarize the core service',
  'Name the customers this business exists for',
  'State the proof',
];

const isFilledString = (v) => typeof v === 'string' && v.trim().length > 0;
const someString = (v) => Array.isArray(v) && v.some(isFilledString);
const someObj = (v, key) => Array.isArray(v) && v.some((x) => x && isFilledString(x[key]));

/** Does this fact value count as answered, for its kind? */
export function hasValue(kind, value, field = null) {
  switch (kind) {
    case 'list': case 'topics': return someString(value);
    case 'people': return someObj(value, 'name');
    case 'roles': return someObj(value, 'title');
    case 'products': return someObj(value, 'name');
    // A `rows` field is answered when its FIRST column has a value in at
    // least one row: that column is always the thing being named.
    case 'rows': return someObj(value, field?.columns?.[0]?.key ?? 'name');
    default: return isFilledString(value);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Light shape/format validation. Returns { ok, errors } — never throws. */
export function validateFacts(facts = {}, modules = []) {
  const errors = [];
  const fields = requirementsFor(modules);
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  for (const [id, value] of Object.entries(facts)) {
    const f = byId[id];
    if (!f) continue; // ignore unknown keys (forward-compatible)
    if (f.kind === 'email' && isFilledString(value) && !EMAIL_RE.test(value.trim())) {
      errors.push(`${f.label}: that does not look like an email address.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Compute readiness. Only text facts gate a build now: photos (gallery, hero,
 * etc.) are uploaded in the Photos step and are always optional, so nothing here
 * depends on asset compartments. The options arg is accepted for call-site
 * compatibility and otherwise unused.
 */
export function readiness(facts = {}, modules = [], _opts = {}) {
  const fields = requirementsFor(modules);
  const missing = [];
  for (const f of fields) {
    if (!f.required) continue;
    if (!hasValue(f.kind, facts[f.id], f)) missing.push({ id: f.id, label: f.label, group: f.group });
  }
  const required = fields.filter((f) => f.required);
  const answered = required.length - missing.length;
  return { ready: missing.length === 0, requiredCount: required.length, answeredCount: answered, missing };
}
