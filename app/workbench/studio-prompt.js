/*
 * The Studio's authoring contract, shared VERBATIM by two consumers:
 *   - the Workbench browser app (classic script -> globalThis.STUDIO_PROMPTS),
 *     which drives interactive generations through /workbench/chat, and
 *   - the API server (CommonJS via createRequire in lib/studio-bundle.mjs),
 *     which drives Batch Building generations through the provider Batch API.
 * One source of truth so batch-built templates meet exactly the same rulebook
 * as interactive ones. Keep this file dependency-free and environment-neutral.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.STUDIO_PROMPTS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

const RULEBOOK_PROMPT = `You are building a website TEMPLATE for the Deneb4 / Stardrive site engine, a
deterministic assembler that turns one template into many differently themed
client marketing sites. Your deliverable must pass an automated acceptance
gate. Every rule marked MUST is enforced by validation or QA and is
non-negotiable. Everything not restricted is yours to design, and a
distinctive, opinionated design is the entire point of a new template. The
operator will describe the desired look and audience after this prompt.

=====================================================================
1. DELIVERABLE (MUST)
=====================================================================
One repository folder:

  your-template-name/
    manifest.json        (the contract; see section 3)
    files/               (the COMPLETE site payload; copied verbatim onto
                          the assembled site's root)

Never include node_modules, .git, .next, or any .env file. Template name:
a lowercase slug (a-z, 0-9, hyphens), e.g. "aurora-loft".

=====================================================================
2. STACK (MUST)
=====================================================================
files/ is a complete, standalone Next.js site that runs with
"npm install && npm run dev" on its own:

- Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 3.
- HARD RULE (these FAIL next build, and TS "ignore build errors" does NOT save
  you): any file that uses a JSX event handler (onClick, onChange, onSubmit,
  etc.) or a React hook (useState/useEffect) MUST have "use client" as its very
  first line. A Server Component (no "use client") may NEVER write an event
  handler or pass a function to a child. Do not leave stray/no-op handlers
  (e.g. onClick={() => {}}) in a server file.
- HARD RULE: a "use client" file MUST NOT export "metadata" or
  "generateMetadata" (server-only). Set the page title via the metadata export
  in a SERVER file (the layout or a sibling server component), never in the same
  file as the interactivity.
- tailwind.config.ts MUST set darkMode: "class" and MUST map the theme
  tokens verbatim in theme.extend.colors:

    colors: {
      accent: "rgb(var(--accent) / <alpha-value>)",
      "accent-strong": "rgb(var(--accent-strong) / <alpha-value>)",
      "on-accent": "rgb(var(--accent-contrast, 255 255 255) / <alpha-value>)",
      base: "rgb(var(--bg-base) / <alpha-value>)",
      surface: "rgb(var(--bg-surface) / <alpha-value>)",
      heading: "rgb(var(--text-heading) / <alpha-value>)",
      body: "rgb(var(--text-body) / <alpha-value>)",
      muted: "rgb(var(--text-muted) / <alpha-value>)",
    }

- package.json, next.config.ts, tsconfig.json, postcss.config.mjs all live
  inside files/.

=====================================================================
3. manifest.json (MUST)
=====================================================================
At the repo root (NOT inside files/). Example, adapt values:

{
  "name": "aurora-loft",
  "version": "1.0.0",
  "kind": "site",
  "description": "Technical description of the template for an agent matching it to a client brief.",
  "clientFacingSummary": "One plain-language sentence usable in a client proposal.",
  "keywords": ["boutique", "portfolio", "warm"],
  "provides": {
    "routes": ["/", "/about", "/contact"],
    "nav": [],
    "adminPanels": [],
    "collections": []
  },
  "copy": [{ "from": "files", "to": "." }]
}

Rules:
- kind is exactly "site" for a base template.
- provides.routes MUST list EVERY page route your payload creates (pages
  only, not API routes). Add every extra page you design.
- NEVER claim these reserved routes; feature modules own them:
  /admin, /catalog, /careers, /insights, /gallery.
- No keys other than the ones shown plus optionally: $schema, requires,
  optionalIntegrations, env, npmDependencies, npmDevDependencies,
  postAssemble, assetSlots. Unknown keys are rejected.
- assetSlots (optional): EXTRA asset compartments your template needs
  beyond the standard set every site template already has (logo, favicon,
  hero, about, gallery, team, misc, those ids are reserved). Each entry:
  { "id": "menu-pages", "label": "Menu pages",
    "description": "One image per menu page.",
    "accept": ["jpg","jpeg","png"], "max": 8 }
  accept is a subset of png, jpg, jpeg, webp, svg, gif, ico; max is 1-50.
  The engine slots uploads for slot "x" under public/assets/x/, read
  imagery from there with graceful fallbacks when a compartment is empty.

=====================================================================
4. THE THEME-TOKEN CONTRACT (MUST; the most important section)
=====================================================================
The engine themes your template per client by REPLACING the file
files/src/app/theme.css with a validated palette. Therefore:

- theme.css is the ONLY file that contains palette color values. Ship it
  with a tasteful default light palette on :root and a dark palette in a
  .dark block. Values are SPACE-SEPARATED RGB CHANNELS ("67 56 202", not
  hex), consumed as rgb(var(--token) / alpha). The eight tokens:

    --accent            brand accent (links, highlights; in dark mode this
                        becomes a LIGHT readable tint, never assume it is dark)
    --accent-strong     stronger accent (hover states)
    --accent-contrast   text ON accent fills: white in light mode, near-black
                        ink in dark mode. Always pair bg-accent with
                        text-on-accent; never hardcode white-on-accent.
    --bg-base           page background
    --bg-surface        cards, nav, raised surfaces
    --text-heading      headings
    --text-body         body text
    --text-muted        secondary text

- Everywhere else, consume tokens only: the Tailwind names from section 2
  (text-heading, bg-surface, text-on-accent, ...) or
  rgb(var(--token) / alpha) in CSS.
- HARD ERROR (the import gate rejects the template): using a TEXT token at
  reduced opacity, e.g. class "text-muted/80" or CSS
  "rgb(var(--text-muted) / 0.8)". Reduced-opacity text breaks the 4.5:1
  contrast floor. Use --text-muted at full strength for secondary text.
- WARNING (flagged for human review): any hardcoded color literal (hex,
  rgb(), hsl()) outside theme.css. Decorative alpha overlays built from
  ACCENT or BG tokens (e.g. bg-accent/10) are fine and encouraged.
- Both of your default palettes must hold 4.5:1 contrast for body text on
  its backgrounds. The engine validates palettes with the same math.

=====================================================================
5. FILES THE ENGINE REWRITES (MUST ship ALL, with working defaults)
=====================================================================
The assembler rewrites these files per client. Your template MUST include
every one of them (so it runs standalone) and MUST read from them (so the
rewrite actually changes the site). Exact paths and export shapes:

files/src/config/site.ts
  export const siteConfig = { name, tagline, description, contactEmail,
    phone, address }   // all strings; ALL site identity comes from here.
  export const baseNav: NavItem[]      // e.g. Home, About
  export const tailNav: NavItem[]      // e.g. Contact (pinned last)
  export const announcement: Announcement | null   // null = hidden
  export const quoteConfig: QuoteConfig            // { enabled, topics }
  export const socialLinks: SocialLink[]           // footer; empty = hidden
  export const faq: FaqItem[]                      // home FAQ; empty = hidden
  export const logoWall: LogoWall                  // home logo strip; empty = hidden
  NEVER hardcode a business name, email, or address anywhere else.

files/src/types/index.ts  (ship these interfaces verbatim)
  interface NavItem { label: string; href: string; description?: string;
    children?: NavItem[] }   // children = dropdown/mega-menu grouping
  interface Announcement { text: string; href?: string; linkLabel?: string }
  interface QuoteConfig { enabled: boolean; topics: string[] }
  interface SocialLink { label: string; href: string }
  interface FaqItem { q: string; a: string }
  interface MarqueeItem { name: string; src?: string; subtitle?: string;
    size?: "sm" | "md" | "lg" }
  interface LogoWall { title?: string; items: MarqueeItem[] }

files/src/config/fonts.generated.ts
  Exports displayFont and bodyFont via next/font/google with
  variable: "--font-display" and "--font-body". Default to Sora (display)
  and Manrope (body). THE ENGINE SWAPS THE FONT FAMILIES PER CLIENT: design
  your type SCALE, weights, and rhythm, but never depend on a specific
  family's quirks.

files/src/config/design.generated.ts
  export const pairingId: string   // default "modern-signal"
  export const motionMode: string  // default "reveal-fast"; see section 7
  export const darkMode: boolean   // default true; see section 6

files/src/config/nav.generated.ts
  export const moduleNav: NavItem[]  // default []
  Header and footer MUST render nav as: baseNav, then moduleNav, then
  tailNav (feature modules append their pages here at assembly time).

files/src/config/admin-panels.generated.tsx
  export interface AdminPanel { id: string; label: string;
    Component: ComponentType }
  export const adminPanels: AdminPanel[] = []
  (Unused without the CMS module, but the file must exist.)

files/src/app/theme.css   (section 4)
files/src/app/layout.tsx  (section 6)

files/src/config/assets.generated.ts
  export const siteAssets: Record<string, string[]> = {};
  THE CUSTOMER'S UPLOADED PHOTOS. At assembly the engine rewrites this file
  with public URL paths keyed by compartment id: logo, hero, hero-about,
  hero-contact, hero-<page>, about, gallery, team, misc (plus any assetSlots
  you declare). Your template MUST consume it with graceful fallbacks so real
  uploads appear:
  - HERO IS DESIGN, NEVER A PHOTO. Always design the hero as a text headline
    with your own visual treatment (gradients / shapes / type). No hero image
    is ever generated. When siteAssets.hero?.[0] is present, render it as the
    HOME hero BACKGROUND behind the text (absolutely positioned, object-cover,
    with a dark scrim so the headline stays legible); with none, the designed
    hero shows as-is. Do NOT render the hero upload as a separate banner.
  - Per-page hero backgrounds: for every other page, when
    siteAssets["hero-<page>"]?.[0] is present (e.g. "hero-about",
    "hero-contact", "hero-gallery", "hero-careers"), render it as that page's
    header BACKGROUND behind the title; otherwise show the designed header.
  - logo: render <img src={siteAssets.logo[0]}> in the header when
    present; the styled text logo is the fallback. Size it well: around
    h-10 / h-11 with object-contain and a max-width (e.g. max-w-[200px])
    so it scales properly instead of rendering tiny. Prefer transparent
    PNGs so it blends into the header background.
  - gallery/portfolio page: render siteAssets.gallery images when
    present; your placeholder grid is the fallback.
  - about/team: same pattern where your design has imagery.
  Ship the file with an empty {} default so the template runs standalone.

files/src/config/content.generated.ts
  export const siteContent: SiteContent = { ... };
  THE FINISHED COPY for this site, written from the owner's answers. At
  assembly the engine REWRITES this file with the real copy. This is how a
  site ships DONE, not DIY: your pages MUST render body copy from siteContent
  and NEVER hardcode client-specific text or leave "sample"/"Replace this"
  placeholders. The build FAILS if any filler phrase survives on any page.
  Shape (all fields always present; render only what is non-empty, hide the
  rest, no empty headings):
    tagline; description
    home: { heroHeadline, heroSubhead, ctaLabel, introHeading, introBody }
    about: { heading, paragraphs: string[], mission }
    services: { name, description }[]
    contact: { heading, intro }
    faq: { question, answer }[]
    team: { name, role, bio }[]
    careers: { heading, intro, roles: { title, summary }[] } | null
    store: { heading, intro, products: { name, price, description }[] } | null
    blog: { heading, intro, posts: { title, excerpt, body }[] } | null
  Rules:
  - Home "what we offer" section: map siteContent.services to cards; use
    home.introHeading/introBody for the intro. No invented sample services.
  - About page: render siteContent.about.paragraphs (fallback
    siteConfig.description) and about.mission. No "Replace this" placeholder.
  - Portfolio/lookbook/gallery page: show siteAssets.gallery photos; never
    ship "sample stories" or "image placeholder" filler.
  - Careers → siteContent.careers.roles; store → siteContent.store.products;
    blog → siteContent.blog.posts. Each section hidden when null/empty.
  - FAQ → siteContent.faq (or the config faq). Never dummy Q&A.
  Ship an interface + a default (empty strings / [] / null) so it compiles
  standalone; the engine fills the real copy at assembly.

=====================================================================
6. REQUIRED ROUTES AND BEHAVIORS (MUST)
=====================================================================
- Pages: / (home), /about, /contact, plus a styled not-found.tsx. Also ship
  robots.ts and sitemap.ts (reading routes you actually have).
- /contact has a working form that POSTs JSON to /api/contact.
- files/src/app/api/contact/route.ts: accepts POST JSON
  { name, email, message, company?, phone?, topic? }, validates name/email/
  message, returns { ok: true }. If process.env.RESEND_API_KEY is set, send
  the message via Resend to siteConfig.contactEmail; otherwise console.log
  the payload and still return ok (dev-friendly).
- Quote flow: when quoteConfig.enabled, a site-wide quote-request modal
  listens for the DOM event "d4:open-quote-modal"
  (window.dispatchEvent(new CustomEvent("d4:open-quote-modal"))) and posts
  to /api/contact including a topic select fed by quoteConfig.topics (hide
  the select when topics is empty). Header CTA and any quote buttons fire
  that event. When quoteConfig.enabled is false, those CTAs link to
  /contact instead.
- Announcement bar renders above the header when announcement is not null.
- Home page seams: render a FAQ section when faq is non-empty and a logo
  strip when logoWall.items is non-empty (both hidden when empty). Design
  them however you like.
- Footer renders socialLinks when non-empty.
- layout.tsx wires the system on the <html> element:
  data-motion={motionMode} and className including
  displayFont.variable and bodyFont.variable.

DARK MODE (MUST):
- Strategy is class-based: the "dark" class on <html>.
- When darkMode is true: render a small theme toggle in the header;
  persist the choice in localStorage under the key "d4-theme"; include a
  tiny inline pre-paint script in layout.tsx that applies the stored choice
  (or the system preference) before hydration, with
  suppressHydrationWarning on <html>.
- When darkMode is false: no toggle, light only, no dark-mode script.
- Design BOTH modes. Check every section against the default light AND dark
  palettes. In dark mode accents are light tints and --accent-contrast is
  dark ink; anything you built assuming a dark accent on white will break.

=====================================================================
7. MOTION (MUST rules, free expression inside them)
=====================================================================
motionMode is one of: reveal-fast, reveal-slow, ambient-drift,
hover-precision, hover-precision-strong, playful-bounce. The engine sets it
per client; your template keys its motion off [data-motion="..."] selectors
in a dedicated motion stylesheet. Hard rules:
- Honor prefers-reduced-motion: no transform/opacity animation when the
  user prefers reduced motion.
- Scroll-reveal classes are added by JavaScript only (e.g. an
  IntersectionObserver component): with JS disabled, ALL content is fully
  visible. Never ship markup that starts hidden.
- Give at least the reveal-fast and reveal-slow modes a real treatment;
  the others may share styles if your design has no use for them.

=====================================================================
8. THE QA BAR (every assembled site must pass; design within it)
=====================================================================
- Every declared route renders with a correct <title> and EXACTLY ONE h1.
- No broken internal links (every href you render resolves).
- Zero browser console errors.
- axe accessibility scan: zero critical or serious violations, including
  real color contrast (4.5:1 for body text).
- No horizontal overflow at a 375 px viewport. Wide content (tables, code)
  scrolls inside its own container, never the page.

=====================================================================
9. WHAT IS YOURS TO DESIGN (make it distinctive)
=====================================================================
Layout systems, grid and section design, hero concepts, the component
inventory beyond the required seams, typographic scale and rhythm, spacing,
borders, radii, shadows, imagery treatment, additional pages (declared in
the manifest), decorative motion within section 7, and placeholder copy
structure. The engine re-themes and re-fonts your design per client, so aim
for a structural and visual identity strong enough to survive any validated
palette and any font pairing. Do not converge on generic "AI template"
looks; commit to a specific point of view matching the operator's brief.

=====================================================================
10. PLACEHOLDER CONTENT (MUST)
=====================================================================
Never invent facts about a real business. All identity comes from
siteConfig; placeholder copy elsewhere must be generic and clearly
replaceable, written naturally for the audience the template targets.

=====================================================================
11. SELF-CHECK BEFORE DELIVERING (run this list, fix, then deliver)
=====================================================================
[ ] manifest.json routes exactly match the pages that exist
[ ] All eight section-5 files exist at their exact paths with the exact
    export names
[ ] Zero occurrences of text-muted/, text-body/, text-heading/ followed by
    a number, and zero rgb(var(--text-...) / ...) at reduced alpha
[ ] Color literals outside theme.css are deliberate and minimal
[ ] Both palettes checked: light and dark
[ ] One h1 per page; titles set; contact form posts; quote modal opens on
    the d4:open-quote-modal event
[ ] Content visible with JavaScript disabled`;

const STUDIO_FORMAT = `

=====================================================================
DELIVERY FORMAT FOR THIS ENVIRONMENT (MUST, replaces zip delivery)
=====================================================================
Deliver every file as a plain block, exactly:

=== FILE: <path> ===
<raw file content>
=== END FILE ===

- manifest.json's path is exactly: manifest.json
- Payload paths are relative WITHOUT the "files/" prefix
  (e.g. src/app/page.tsx, tailwind.config.ts).
- Text files only; no binaries (use inline SVG where an image is needed).
- To revise, re-send only the changed files with the same paths; a
  re-sent path replaces the earlier version.
- Outside the blocks, keep commentary brief.`;

// `module` ties a feature to a real d4 engine module added at assembly time.
// Features without `module` are template-design elements the AI builds in.
const FEATURES = [
  { id: 'contact-form', label: 'Contact form', prompt: 'A working contact form on /contact posting to /api/contact.' },
  { id: 'quote', label: 'Quote request', prompt: 'A site-wide "request a quote" modal opened by header/CTA buttons (the d4:open-quote-modal event), posting to /api/contact with a topic select.' },
  { id: 'gallery', label: 'Photo gallery', prompt: 'A photo gallery / portfolio grid page.', module: 'd4-gallery-editor' },
  { id: 'blog', label: 'Blog / articles', prompt: 'A blog: an article listing page plus individual post pages.', module: 'd4-insights-blog' },
  { id: 'store', label: 'Online store', prompt: 'A product catalog / simple store: product cards with prices and a product detail page.', module: 'd4-catalog' },
  { id: 'careers', label: 'Careers / jobs', prompt: 'A careers page listing open roles with an apply flow.', module: 'd4-careers-portal' },
  { id: 'cms', label: 'Editable content (admin)', prompt: 'An admin dashboard so the site owner can edit content without code.', module: 'd4-cms-core' },
  { id: 'booking', label: 'Booking / appointments', prompt: 'A prominent "book an appointment" call to action linking to /book.', module: 'd4-booking' },
  { id: 'testimonials', label: 'Testimonials', prompt: 'A testimonials section with customer quotes.', module: 'd4-testimonials' },
  { id: 'faq', label: 'FAQ', prompt: 'An FAQ section with an accordion.' },
  { id: 'team', label: 'Team / staff profiles', prompt: 'A team section with member profiles.', module: 'd4-team' },
  { id: 'newsletter', label: 'Newsletter', prompt: 'A newsletter email-capture form.', module: 'd4-newsletter' },
  { id: 'events', label: 'Events / what\'s on', prompt: 'An events section highlighting what is coming up, linking to /events.', module: 'd4-events' },
  { id: 'menu', label: 'Food / drink menu', prompt: 'A menu highlight section linking to the full menu at /menu.', module: 'd4-menu' },
  { id: 'payments', label: 'Take payments', prompt: 'Clear "buy" or "pay a deposit" calls to action linking to /pay.', module: 'd4-payments' },
  { id: 'legal', label: 'Privacy / terms pages', prompt: 'Footer links to the privacy policy and terms at /legal.', module: 'd4-legal' },
  { id: 'pricing', label: 'Pricing table', prompt: 'A pricing section with tiered plans.' },
  { id: 'dark-mode', label: 'Dark mode', prompt: 'A visible light/dark theme toggle in the header (class-based, persisted).' },
  { id: 'announcement', label: 'Announcement bar', prompt: 'An announcement bar above the header for notices/promotions.' },
  { id: 'map', label: 'Map / opening hours', prompt: 'A location section: address and opening hours, linking to /locations.', module: 'd4-locations' },
  { id: 'social', label: 'Social links', prompt: 'Social media links in the footer.' },
];

/** The REQUESTED FEATURES prompt block for an explicit set of feature ids. */
function featureBlockFor(ids) {
  const set = new Set(ids || []);
  const on = FEATURES.filter((f) => set.has(f.id));
  if (!on.length) return '';
  return '\n\n=====================================================================\n'
    + 'REQUESTED FEATURES (the customer toggled these ON, include ALL of them,\n'
    + 'and declare any new page routes they add in manifest.provides.routes)\n'
    + '=====================================================================\n'
    + on.map((f) => `- ${f.label}: ${f.prompt}`).join('\n')
    + '\nBuild these into the template design at descriptive routes of your own '
    + '(e.g. /portfolio, /work, /shop). Do NOT use the reserved routes /admin, '
    + '/catalog, /careers, /insights, /gallery, /book, /team, /testimonials, '
    + '/locations, /events, /menu, /pay, /legal or /unsubscribe: those belong to '
    + 'engine modules, and reusing one fails the build with a route conflict. '
    + 'Where a feature above has an engine module, the module supplies the page '
    + 'itself, so design a SECTION that links to it rather than a rival page.';
}

/** The d4 engine modules implied by a set of enabled feature ids. */
function modulesForFeatures(ids) {
  const set = new Set(ids || []);
  return FEATURES.filter((f) => f.module && set.has(f.id)).map((f) => f.module);
}

return { RULEBOOK_PROMPT, STUDIO_FORMAT, FEATURES, featureBlockFor, modulesForFeatures };
});
