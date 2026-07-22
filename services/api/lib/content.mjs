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
};

// Content every site needs (the base template always ships home/about/contact).
const ALWAYS = [
  { id: 'whatYouDo', group: 'identity', label: 'What does the business do?', kind: 'line', required: true,
    help: 'One plain sentence. The AI turns this into your headline and tagline.' },
  { id: 'aboutFacts', group: 'about', label: 'A few facts about the business', kind: 'facts', required: true,
    help: 'Notes are fine: when it started, who it serves, what makes it different. The AI writes the About page from these.' },
  { id: 'services', group: 'offerings', label: 'Main services or offerings', kind: 'list', required: true,
    help: 'List the handful of things you offer. The AI writes a short description for each.' },
  { id: 'contactEmail', group: 'contact', label: 'Contact email', kind: 'email', required: true,
    help: 'Where enquiries should go. Shown on the contact page and footer.' },
  { id: 'phone', group: 'contact', label: 'Phone', kind: 'tel', required: false },
  { id: 'address', group: 'contact', label: 'Address', kind: 'address', required: false },
  { id: 'hours', group: 'contact', label: 'Opening hours', kind: 'hours', required: false,
    help: 'e.g. "Mon–Fri 9–5, closed weekends".' },
  { id: 'team', group: 'team', label: 'Team members', kind: 'people', required: false,
    help: 'Name and role for each person to feature. The AI writes a short bio.' },
  { id: 'faqTopics', group: 'faq', label: 'Common questions', kind: 'list', required: false,
    help: 'List questions customers ask; the AI writes clear answers.' },
  { id: 'socials', group: 'social', label: 'Social links', kind: 'list', required: false,
    help: 'Full URLs, one per profile.' },
];

// Extra required content unlocked by a chosen feature module.
const MODULE_FIELDS = {
  'd4-careers-portal': [
    { id: 'roles', group: 'careers', label: 'Open roles', kind: 'roles', required: true,
      help: 'A title and one-line summary per role. The AI writes the full posting.' },
  ],
  'd4-catalog': [
    { id: 'products', group: 'store', label: 'Products', kind: 'products', required: true,
      help: 'Name, price, and a short note per product. The AI writes the descriptions.' },
  ],
  'd4-insights-blog': [
    { id: 'articleTopics', group: 'blog', label: 'Article topics', kind: 'topics', required: true,
      help: 'A few topics to launch with. The AI drafts the opening posts.' },
  ],
  'd4-gallery-editor': [
    { id: 'galleryPhotos', group: 'gallery', label: 'Gallery photos', kind: 'photos', required: true,
      help: 'Upload photos in the Gallery compartment — the gallery page needs at least one.' },
  ],
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
export function hasValue(kind, value) {
  switch (kind) {
    case 'list': case 'topics': return someString(value);
    case 'people': return someObj(value, 'name');
    case 'roles': return someObj(value, 'title');
    case 'products': return someObj(value, 'name');
    case 'photos': return false; // satisfied via assets, checked by the caller
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
 * Compute readiness. `assetSlots` is the set of compartment ids that currently
 * hold at least one upload (so the gallery-photos requirement can be checked).
 */
export function readiness(facts = {}, modules = [], { assetSlots = [] } = {}) {
  const fields = requirementsFor(modules);
  const slots = new Set(assetSlots);
  const missing = [];
  for (const f of fields) {
    if (!f.required) continue;
    const ok = f.kind === 'photos' ? slots.has('gallery') : hasValue(f.kind, facts[f.id]);
    if (!ok) missing.push({ id: f.id, label: f.label, group: f.group });
  }
  const required = fields.filter((f) => f.required);
  const answered = required.length - missing.length;
  return { ready: missing.length === 0, requiredCount: required.length, answeredCount: answered, missing };
}
