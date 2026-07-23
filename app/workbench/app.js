/* Stardrive Workbench, plain JS, no build step, same-origin API. */
'use strict';

/* ══════════════ The authoring rulebook (system prompt for the Studio) ══════════════ */
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
- HARD RULE (a "use client" file that exports metadata FAILS the build):
  any file with "use client" at the top (i.e. it uses useState/useEffect/
  onClick/hooks) MUST NOT export "metadata" or "generateMetadata" — those are
  server-only. Put page copy/interactivity in the client page, and set the
  title via the metadata export in a SERVER file (the layout, or a sibling
  server component). Never both in one file.
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
  with public URL paths keyed by compartment id: logo, hero, about,
  gallery, team, misc (plus any assetSlots you declare). Your template
  MUST consume it with graceful fallbacks so real uploads appear:
  - hero: use siteAssets.hero?.[0] as the hero image when present; your
    designed hero (gradients/shapes/type) is the fallback.
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

/* ══════════════ Small utilities ══════════════ */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TEXT_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|css|json|md|svg|txt|html|yml|yaml)$/i;

function getApiKey() { return localStorage.getItem('sd.apiKey') || ''; }

async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      ...(getApiKey() ? { Authorization: 'Bearer ' + getApiKey() } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = raw ? await res.text() : await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body: data };
}

function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1800);
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.copybtn');
  if (!btn) return;
  const pre = btn.closest('.codeblock')?.querySelector('pre');
  if (!pre) return;
  navigator.clipboard.writeText(pre.textContent).then(() => flash(btn, 'Copied ✓'));
});

/* ══════════════ Theme ══════════════ */
const THEMES = ['system', 'light', 'dark'];
function applyTheme(t) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  $('#themeBtn').textContent = 'Theme: ' + t;
}
let theme = localStorage.getItem('sd.theme') || 'system';
applyTheme(theme);
$('#themeBtn').addEventListener('click', () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  localStorage.setItem('sd.theme', theme);
  applyTheme(theme);
});

/* ══════════════ Router ══════════════ */
const TITLES = {
  home: 'Home', templates: 'My templates', studio: 'AI Studio',
  sites: 'Sites', connections: 'Hosting',
  reference: 'API reference', keys: 'API keys', billing: 'Plan & usage', rulebook: 'Rulebook',
};
function route() {
  const view = (location.hash.replace('#/', '') || 'home').split('?')[0];
  const v = TITLES[view] ? view : 'home';
  document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === 'view-' + v));
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.view === v));
  $('#viewTitle').textContent = TITLES[v];
  if (v === 'home') loadHome();
  if (v === 'templates') loadTemplates();
  if (v === 'sites') { loadSites(); loadSiteTemplateOptions(); }
  if (v === 'connections') loadConnections();
  if (v === 'keys') { renderMaskedKey(); loadKeys(); }
  if (v === 'billing') loadBilling();
}
window.addEventListener('hashchange', route);

/* ══════════════ Home (guided journey) ══════════════ */
async function loadHome() {
  if (!getApiKey()) return;
  // Step 1, templates (imports beyond the shared catalog).
  try {
    const { body } = await api('/v1/templates');
    const mine = (body.templates || []).filter((t) => t.source !== 'bundled').length;
    const total = (body.templates || []).length;
    setStep('jstep-1', 'homeTemplates', mine > 0,
      mine > 0 ? `You have <span class="ok">${mine} of your own template${mine === 1 ? '' : 's'}</span> (plus ${total - mine} from the catalog).`
               : `<span class="todo">No templates of your own yet, the ${total}-design catalog is ready to start from.</span>`);
  } catch { /* not logged in / no key */ }
  // Step 2, sites.
  try {
    const { body } = await api('/v1/sites');
    const n = (body.sites || []).length;
    setStep('jstep-2', 'homeSites', n > 0,
      n > 0 ? `<span class="ok">${n} site${n === 1 ? '' : 's'} built.</span>` : '<span class="todo">No sites built yet.</span>');
  } catch { /* ignore */ }
  // Step 3, hosting.
  try {
    const { status, body } = await api('/v1/connections');
    if (status === 200) {
      const connected = Object.entries(body.connections).filter(([, c]) => c.connected).map(([p]) => p);
      setStep('jstep-3', 'homeHosting', connected.length > 0,
        connected.length ? `<span class="ok">Connected: ${connected.join(', ')}.</span>` : '<span class="todo">No hosting connected yet, you can still export finished sites.</span>');
    }
  } catch { /* ignore */ }
}
function setStep(stepId, statusId, done, html) {
  const el = document.getElementById(statusId);
  if (el) el.innerHTML = html;
  document.getElementById(stepId)?.classList.toggle('done', done);
}

/* ══════════════ Auth gate ══════════════ */
async function whoami() {
  try {
    const res = await fetch('/auth/me');
    if (!res.ok) return null;
    return (await res.json()).account;
  } catch { return null; }
}

function showGate() {
  $('#authGate').hidden = false;
  $('#appLayout').hidden = true;
}
function showApp(account) {
  $('#authGate').hidden = true;
  $('#appLayout').hidden = false;
  $('#acctEmail').textContent = account.email;
}

let authMode = 'login';
document.querySelectorAll('.authtab').forEach((t) => t.addEventListener('click', () => {
  authMode = t.dataset.authtab;
  document.querySelectorAll('.authtab').forEach((x) => x.classList.toggle('active', x === t));
  $('#companyRow').hidden = authMode !== 'signup';
  $('#authSubmit').textContent = authMode === 'signup' ? 'Create account' : 'Log in';
  $('#authForm').querySelector('[name="password"]').setAttribute('autocomplete', authMode === 'signup' ? 'new-password' : 'current-password');
  $('#authNote').textContent = '';
}));

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const note = $('#authNote');
  note.className = 'authnote';
  const data = Object.fromEntries(new FormData(e.target).entries());
  $('#authSubmit').disabled = true;
  try {
    const res = await fetch('/auth/' + authMode, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { note.className = 'authnote err'; note.textContent = body.error?.message || 'Something went wrong.'; return; }
    if (authMode === 'signup' && body.apiKey?.secret) {
      // Auto-adopt the first key for product calls, and reveal it once.
      localStorage.setItem('sd.apiKey', body.apiKey.secret);
      $('#apiKeyInput').value = body.apiKey.secret;
    }
    showApp(body.account);
    renderMaskedKey();
    // New customers land on the guided Home; returning users on their last view.
    if (authMode === 'signup') location.hash = '#/home';
    route();
  } finally {
    $('#authSubmit').disabled = false;
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  localStorage.removeItem('sd.apiKey');
  location.reload();
});

/* ══════════════ API key chip ══════════════ */
$('#apiKeyInput').value = getApiKey();
$('#saveKeyBtn').addEventListener('click', () => {
  localStorage.setItem('sd.apiKey', $('#apiKeyInput').value.trim());
  flash($('#saveKeyBtn'), 'Saved ✓');
  renderMaskedKey();
  loadTemplates();
});

function renderMaskedKey() {
  const k = getApiKey();
  $('#maskedKey').textContent = k ? k.slice(0, 12) + '…' + k.slice(-4) : 'none saved';
}

/* ══════════════ Health / service card ══════════════ */
$('#baseUrl').textContent = location.origin;
$('#healthCurl').textContent = 'curl ' + location.origin + '/v1/health';
(async () => {
  try {
    const { body } = await api('/v1/health');
    $('#statusDot').className = 'statusdot up';
    $('#statusText').textContent = 'API up';
    $('#versionText').textContent = 'v' + body.version + ' · engine: ' + body.engine;
    $('#svcStatus').textContent = 'up';
    $('#svcVersion').textContent = body.version;
    $('#svcEngine').textContent = body.engine;
    applyStudioConfig(body.studio);
  } catch {
    $('#statusDot').className = 'statusdot down';
    $('#statusText').textContent = 'API unreachable';
    $('#svcStatus').textContent = 'unreachable';
    applyStudioConfig({ enabled: false });
  }
})();

/* ══════════════ Templates ══════════════ */
async function loadTemplates() {
  const tbody = $('#templateTable tbody');
  if (!getApiKey()) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">Save an API key to load your library.</td></tr>';
    return;
  }
  const { status, body } = await api('/v1/templates');
  if (status === 401 || status === 403) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--bad)">' +
      (status === 401 ? 'That key was not accepted.' : 'This key lacks the templates scope.') + '</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  for (const t of body.templates) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td><code>' + esc(t.name) + '</code></td>' +
      '<td>' + esc(t.kind) + '</td>' +
      '<td>' + esc(t.version) + '</td>' +
      '<td><span class="badge ' + (t.source === 'bundled' ? 'bundled' : 'imported') + '">' + esc(t.source) + '</span></td>' +
      '<td>' + t.routes.length + '</td>' +
      '<td style="white-space:nowrap"><button class="ghost" data-act="view" data-name="' + esc(t.name) + '">Manifest</button> ' +
      (t.source === 'imported' ? '<button class="ghost danger" data-act="del" data-name="' + esc(t.name) + '">Delete</button>' : '') + '</td>';
    tbody.appendChild(tr);
  }
}

$('#templateTable').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const name = btn.dataset.name;
  if (btn.dataset.act === 'view') {
    const { body } = await api('/v1/templates/' + encodeURIComponent(name));
    $('#manifestPanel').innerHTML =
      '<h3 style="margin-top:1rem;color:var(--ink)">' + esc(name) + '</h3>' +
      '<div class="codeblock"><pre>' + esc(JSON.stringify(body.manifest, null, 2)) + '</pre><button class="copybtn" type="button">Copy</button></div>' +
      (body.warnings?.length ? '<div class="report err"><b>Lint warnings kept on this import:</b><ul>' + body.warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul></div>' : '');
  }
  if (btn.dataset.act === 'del') {
    if (!confirm('Delete "' + name + '" from your library?')) return;
    await api('/v1/templates/' + encodeURIComponent(name), { method: 'DELETE' });
    $('#manifestPanel').innerHTML = '';
    loadTemplates();
  }
});

/* Folder upload → bundle → import. */
const drop = $('#dropzone');
drop.addEventListener('click', () => $('#folderInput').click());
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  drop.classList.remove('drag');
  const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  const files = [];
  async function walk(entry, prefix) {
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej));
      files.push({ path: prefix + entry.name, file: f });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const child of batch) await walk(child, prefix + entry.name + '/');
      } while (batch.length);
    }
  }
  for (const en of entries) await walk(en, '');
  importFromFileList(files);
});
$('#folderInput').addEventListener('change', (e) => {
  const files = [...e.target.files].map((f) => ({ path: f.webkitRelativePath || f.name, file: f }));
  importFromFileList(files);
  e.target.value = '';
});

async function importFromFileList(list) {
  const out = $('#uploadReport');
  out.innerHTML = '<div class="report ok">Reading folder…</div>';
  try {
    if (!list.length) throw new Error('No files found.');
    // Strip a single common root folder.
    const first = list[0].path.split('/')[0];
    const wrapped = list.every((f) => f.path.split('/')[0] === first && f.path.includes('/'));
    const rel = (p) => (wrapped ? p.split('/').slice(1).join('/') : p);
    const skip = /(^|\/)(node_modules|\.git|\.next|dist|out)(\/|$)|(^|\/)\./;

    const manifestFile = list.find((f) => rel(f.path) === 'manifest.json');
    if (!manifestFile) throw new Error('No manifest.json at the folder root. Pick the folder that directly contains manifest.json and files/.');
    const manifest = JSON.parse(await manifestFile.file.text());

    const hasFilesDir = list.some((f) => rel(f.path).startsWith('files/'));
    const files = [];
    for (const f of list) {
      const r = rel(f.path);
      if (r === 'manifest.json' || skip.test(r)) continue;
      const payloadPath = hasFilesDir ? (r.startsWith('files/') ? r.slice(6) : null) : r;
      if (!payloadPath) continue;
      if (TEXT_EXT_RE.test(payloadPath)) {
        files.push({ path: payloadPath, content: await f.file.text() });
      } else {
        const buf = new Uint8Array(await f.file.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        files.push({ path: payloadPath, contentBase64: btoa(bin) });
      }
    }

    out.innerHTML = '<div class="report ok">Validating &amp; importing ' + files.length + ' files…</div>';
    const { status, body } = await api('/v1/templates', { method: 'POST', body: { manifest, files } });
    renderImportReport(out, status, body);
    if (status < 300) loadTemplates();
  } catch (err) {
    out.innerHTML = '<div class="report err">' + esc(err.message || String(err)) + '</div>';
  }
}

function renderImportReport(el, status, body) {
  if (status === 401) { el.innerHTML = '<div class="report err">Save a valid API key first (top right).</div>'; return; }
  if (status < 300) {
    el.innerHTML = '<div class="report ok">✓ Imported <b>' + esc(body.name) + '</b> into your private library.' +
      (body.warnings?.length ? '<div class="warns"><b>Warnings (review deliberately):</b><ul>' + body.warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul></div>' : '') + '</div>';
  } else {
    el.innerHTML = '<div class="report err"><b>Rejected, fix these and re-upload:</b><ul>' +
      (body.errors || [body.error?.message || 'Unknown error']).map((er) => '<li>' + esc(er) + '</li>').join('') + '</ul></div>';
  }
}

/* ══════════════ Feature toggles → AI prompt ══════════════ */
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
  { id: 'booking', label: 'Booking', prompt: 'A booking / appointment request section where visitors request a time.' },
  { id: 'testimonials', label: 'Testimonials', prompt: 'A testimonials section with customer quotes.' },
  { id: 'faq', label: 'FAQ', prompt: 'An FAQ section with an accordion.' },
  { id: 'team', label: 'Team / about', prompt: 'A team/about section with member profiles.' },
  { id: 'newsletter', label: 'Newsletter', prompt: 'A newsletter email-capture form.' },
  { id: 'pricing', label: 'Pricing table', prompt: 'A pricing section with tiered plans.' },
  { id: 'dark-mode', label: 'Dark mode', prompt: 'A visible light/dark theme toggle in the header (class-based, persisted).' },
  { id: 'announcement', label: 'Announcement bar', prompt: 'An announcement bar above the header for notices/promotions.' },
  { id: 'map', label: 'Map / location', prompt: 'A location section with an address and a simple map placeholder.' },
  { id: 'social', label: 'Social links', prompt: 'Social media links in the footer.' },
];
const FEATURE_BY_ID = Object.fromEntries(FEATURES.map((f) => [f.id, f]));
/** Module-backed features enabled → the d4 module names to assemble with. */
function selectedModules() {
  return FEATURES.filter((f) => f.module && enabledFeatures.has(f.id)).map((f) => f.module);
}
const enabledFeatures = new Set(JSON.parse(localStorage.getItem('sd.features') || '["contact-form","dark-mode"]'));

function renderFeatures() {
  const root = $('#featureList');
  if (!root) return;
  root.innerHTML = '';
  for (const f of FEATURES) {
    const on = enabledFeatures.has(f.id);
    const label = document.createElement('label');
    label.className = 'feature' + (on ? ' on' : '');
    label.innerHTML = '<input type="checkbox" ' + (on ? 'checked' : '') + ' data-feature="' + f.id + '"> ' + esc(f.label);
    root.appendChild(label);
  }
  updateFeatureSummary();
}
function updateFeatureSummary() {
  const on = FEATURES.filter((f) => enabledFeatures.has(f.id));
  $('#featureSummary').innerHTML = on.length
    ? 'Sent to the AI with every message: <b>' + on.map((f) => esc(f.label)).join('</b>, <b>') + '</b>.'
    : 'No features selected. Toggle some above, or describe everything in your message.';
}
function featurePromptBlock() {
  const on = FEATURES.filter((f) => enabledFeatures.has(f.id));
  if (!on.length) return '';
  return '\n\n=====================================================================\n'
    + 'REQUESTED FEATURES (the customer toggled these ON, include ALL of them,\n'
    + 'and declare any new page routes they add in manifest.provides.routes)\n'
    + '=====================================================================\n'
    + on.map((f) => `- ${f.label}: ${f.prompt}`).join('\n')
    + '\nBuild these into the template design at descriptive routes of your own '
    + '(e.g. /portfolio, /work, /shop). Do NOT use the reserved routes /admin, '
    + '/catalog, /careers, /insights, or /gallery, those belong to engine modules.';
}
document.getElementById('featureList')?.addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-feature]');
  if (!cb) return;
  if (cb.checked) enabledFeatures.add(cb.dataset.feature); else enabledFeatures.delete(cb.dataset.feature);
  localStorage.setItem('sd.features', JSON.stringify([...enabledFeatures]));
  cb.closest('.feature').classList.toggle('on', cb.checked);
  updateFeatureSummary();
});
renderFeatures();

/* ══════════════ Template Studio ══════════════ */
const chat = { messages: [] };
let studioEnabled = false;

/** Reflect the operator-configured model + on/off state (no key ever exposed). */
function applyStudioConfig(studio) {
  studioEnabled = Boolean(studio?.enabled);
  $('#studioModel').textContent = studioEnabled ? (studio.model || 'configured') : 'not enabled yet';
  $('#sendBtn').disabled = !studioEnabled;
  $('#studioStatus').innerHTML = studioEnabled
    ? '<div class="report ok" style="margin:0">Ready, template generation is on.</div>'
    : '<div class="report" style="margin:0;background:var(--code-bg);color:var(--muted)">The Studio is not enabled yet. It turns on once the operator configures the model, you never need a model key of your own.</div>';
}

function addMsg(role, content) {
  const log = $('#chatlog');
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  if (role === 'systemnote') {
    div.textContent = content;
  } else {
    // Render with fenced code blocks; everything through textContent-safe nodes.
    const parts = String(content).split(/```[a-zA-Z]*\n?/);
    parts.forEach((part, i) => {
      const node = document.createElement(i % 2 ? 'pre' : 'div');
      if (i % 2 === 0) node.className = 'txt';
      node.textContent = part.replace(/\n?```\s*$/, '');
      if (part.trim()) div.appendChild(node);
    });
  }
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

/* ── Guided brief → template generation ── */
const VIBES = ['Warm & friendly', 'Bold & modern', 'Elegant & minimal', 'Playful & bright', 'Classic & trustworthy', 'Sleek & techy'];
let currentVibe = '';

function renderVibes() {
  const el = $('#brVibe');
  if (!el) return;
  el.innerHTML = VIBES.map((v) => '<button type="button" class="chip-btn" data-vibe="' + esc(v) + '">' + esc(v) + '</button>').join('');
}
renderVibes();
$('#brVibe')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-vibe]');
  if (!b) return;
  currentVibe = currentVibe === b.dataset.vibe ? '' : b.dataset.vibe;
  [...$('#brVibe').children].forEach((c) => c.classList.toggle('on', c.dataset.vibe === currentVibe));
});

function setGenResult(html) { const el = $('#genResult'); if (el) el.innerHTML = html; }
function genBusy(on) {
  const g = $('#genBtn'); const s = $('#sendBtn');
  if (g) g.disabled = on;
  if (s) s.disabled = on || !studioEnabled;
}

$('#genBtn')?.addEventListener('click', () => {
  const business = $('#brBusiness').value.trim();
  if (!business) { $('#brBusiness').focus(); setGenResult('<div class="report err">Tell us what kind of business it is to get started.</div>'); return; }
  const colors = $('#brColors').value.trim();
  const audience = $('#brAudience').value.trim();
  const extra = $('#brExtra').value.trim();
  const vibe = [currentVibe, $('#brVibeCustom').value.trim()].filter(Boolean).join('; ');
  const parts = ['Design a website template for ' + business + '.'];
  if (vibe) parts.push('Overall vibe: ' + vibe + '.');
  if (colors) parts.push('Colors: ' + colors + '.');
  if (audience) parts.push('Audience: ' + audience + '.');
  if (extra) parts.push(extra);
  runGeneration(parts.join(' '), true);
});

$('#sendBtn').addEventListener('click', () => {
  const text = $('#chatText').value.trim();
  if (!text) return;
  $('#chatText').value = '';
  runGeneration(text, false);
});
$('#chatText')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#sendBtn').click();
});

async function runGeneration(userText, isFirst) {
  if (!getApiKey()) { setGenResult('<div class="report err">Save your Stardrive API key (top right) first.</div>'); return; }
  if (!studioEnabled) { setGenResult('<div class="report">The Template Studio is not enabled yet, it turns on once the operator configures the model.</div>'); return; }
  chat.messages.push({ role: 'user', content: userText });
  addMsg('user', userText);
  const active = FEATURES.filter((f) => enabledFeatures.has(f.id));
  const featNote = isFirst && active.length ? ' Including: ' + active.map((f) => f.label).join(', ') + '.' : '';
  setGenResult('<div class="report ok" style="display:flex;align-items:center;gap:0.55rem"><span class="spin"></span><span>' + (isFirst ? 'Designing your template' : 'Updating your template') + '… this takes a minute or two.' + esc(featNote) + '</span></div>');
  genBusy(true);
  try {
    const { status, body } = await api('/workbench/chat', {
      method: 'POST',
      body: { system: RULEBOOK_PROMPT + STUDIO_FORMAT + featurePromptBlock(), messages: chat.messages },
    });
    if (status !== 200) {
      setGenResult('<div class="report err">' + esc(body.error?.message || 'Generation failed (' + status + ').') + '</div>');
      chat.messages.pop();
      return;
    }
    chat.messages.push({ role: 'assistant', content: body.content });
    addMsg('assistant', body.content);
    renderGenOutcome(body.content);
  } catch (err) {
    setGenResult('<div class="report err">Network error: ' + esc(err.message) + '</div>');
    chat.messages.pop();
  } finally {
    genBusy(false);
  }
}

/** After each response: a friendly completion card (code hidden), or the
 *  model's question if it didn't deliver files yet. */
function renderGenOutcome(content) {
  const files = collectFiles();
  const fileCount = Object.keys(files).length;
  if (files['manifest.json'] && fileCount > 3) {
    let manifest = {};
    try { manifest = JSON.parse(files['manifest.json']); } catch { /* name-less card */ }
    const routes = (manifest.provides?.routes || []).filter((r) => !r.startsWith('/admin'));
    setGenResult(
      '<div class="card gen-done">' +
      '<div class="done-badge">✨ Your template is complete</div>' +
      '<div class="field" style="margin:0.6rem 0 0.3rem"><label>Name this template</label>' +
      '<input id="tplName" value="' + esc(manifest.name || 'my-template') + '" spellcheck="false" style="max-width:24rem" placeholder="my-template"></div>' +
      '<p style="font-size:0.83rem;color:var(--muted);margin:0 0 0.7rem">' + fileCount + ' files' + (routes.length ? ' · pages: ' + routes.map(esc).join(', ') : '') + '</p>' +
      '<p style="font-size:0.88rem;color:var(--body);margin:0 0 0.7rem">See how it looks before you decide. Preview builds a quick demo with sample content, then keep it or ask for changes.</p>' +
      '<button class="primary" data-genact="preview">👁 Preview this design</button>' +
      '<div id="genPreview" style="margin-top:0.7rem"></div>' +
      '</div>'
    );
    $('#importGenBtn')?.classList.add('glow');
    $('#studioActions')?.classList.add('ready');
    const rw = $('#refineWrap'); if (rw) rw.hidden = false;
  } else {
    const prose = content.replace(/^===\s*FILE:[\s\S]*?^===\s*END FILE\s*===/gm, '').trim();
    setGenResult('<div class="card"><p style="margin:0;white-space:pre-wrap;font-size:0.9rem">' + esc(prose.slice(0, 700) || 'The model replied, open "View the generated files" to see the details.') + '</p></div>');
  }
}

// Preview a generated design BEFORE the operator commits to it: import the
// bundle, build a throwaway demo site with sample content, and show the real
// result (screenshot + a clickable live preview).
const PREVIEW_FACTS = {
  whatYouDo: 'A friendly local business that does great work for its community.',
  aboutFacts: 'Started a few years ago by people who care about the craft. Serves the neighborhood and beyond. Known for quality work and a warm welcome.',
  services: ['A first core service', 'A second core service', 'A third core service'],
  contactEmail: 'hello@example.com', phone: '(555) 123-4567', address: '123 Main Street, Yourtown',
};

$('#view-studio')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-genact]');
  if (!b) return;
  if (b.dataset.genact === 'preview') previewGeneratedDesign();
  if (b.dataset.genact === 'preview-live') previewGeneratedLive(b.dataset.site);
});

/** Pull the real reason a build failed from the job's QA report (the failing
 *  checks + their captured detail, e.g. the next-build error tail), falling
 *  back to the last log line. */
function buildFailureDetail(jobBody) {
  const failed = (jobBody?.result?.qa?.checks || []).filter((c) => c.status === 'fail');
  if (failed.length) {
    return failed.map((c) => c.name + (c.detail ? ':\n' + c.detail : '')).join('\n\n');
  }
  return jobBody?.logs?.at(-1)?.line || 'The build failed; open the build history for details.';
}

async function previewGeneratedDesign() {
  const box = $('#genPreview');
  const spin = (msg) => { box.innerHTML = '<div class="report ok" style="display:flex;align-items:center;gap:0.5rem"><span class="spin"></span><span>' + esc(msg) + '</span></div>'; };
  let bundle;
  try { bundle = buildGeneratedBundle(); } catch (err) { box.innerHTML = '<div class="report err">' + esc(err.message) + '</div>'; return; }
  spin('Preparing a demo of this design…');
  const imp = await api('/v1/templates', { method: 'POST', body: bundle });
  if (imp.status >= 300 && imp.status !== 409) { box.innerHTML = '<div class="report err">' + esc(imp.body.errors?.join('; ') || imp.body.error?.message || 'Could not prepare the template.') + '</div>'; return; }
  const made = await api('/v1/sites', { method: 'POST', body: { templateId: bundle.manifest.name, config: { siteName: 'Preview · ' + bundle.manifest.name }, assemble: false } });
  if (made.status !== 201) { box.innerHTML = '<div class="report err">Could not start the preview.</div>'; return; }
  const siteId = made.body.siteId;
  await api('/v1/sites/' + siteId + '/content', { method: 'PATCH', body: { facts: PREVIEW_FACTS } });
  const built = await api('/v1/sites/' + siteId + '/assemble', { method: 'POST', body: {} });
  if (built.status !== 202) { box.innerHTML = '<div class="report err">' + esc(built.body.error?.message || 'Preview build failed to start.') + '</div>'; return; }
  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    let j;
    try { j = await api('/v1/jobs/' + built.body.jobId); } catch { continue; }
    if (j.status !== 200) continue;
    if (j.body.status === 'done') { showGenPreview(siteId); return; }
    if (j.body.status === 'failed') {
      const detail = buildFailureDetail(j.body);
      box.innerHTML = '<div class="report err"><b>The design did not build.</b> Here is what the build reported:<br>' +
        '<pre style="white-space:pre-wrap;margin:0.5rem 0;font-size:0.78rem;max-height:14rem;overflow:auto">' + esc(detail).slice(0, 6000) + '</pre>' +
        'The fix request is filled into <b>Want changes?</b> below, press <b>Refine</b> and the AI will correct the template.</div>';
      // Queue the exact error for the model, mirroring the import-error loop.
      $('#chatText').value = 'The generated template failed to build with the error below. Fix the affected file(s) and re-send ONLY the changed files (keep everything else):\n\n' + detail;
      const rw = $('#refineWrap'); if (rw) rw.hidden = false;
      return;
    }
    spin('Building the preview (' + (Math.round((Date.now() - started) / 6000) / 10) + ' min)…');
  }
}

async function showGenPreview(siteId) {
  const box = $('#genPreview');
  let img = '';
  try {
    const res = await fetch('/v1/sites/' + siteId + '/preview', { headers: { Authorization: 'Bearer ' + getApiKey() } });
    if (res.ok) img = '<img src="' + URL.createObjectURL(await res.blob()) + '" alt="Design preview" style="max-width:100%;border:1px solid var(--line);border-radius:10px">';
  } catch { /* screenshot optional */ }
  box.innerHTML = '<div class="card">' +
    '<h3 style="margin:0 0 0.5rem">How this design looks</h3>' + img +
    '<div style="margin-top:0.6rem;display:flex;gap:0.5rem;flex-wrap:wrap"><button class="primary" data-genact="preview-live" data-site="' + esc(siteId) + '">▶ Click around it live</button></div>' +
    '<p style="font-size:0.8rem;color:var(--muted);margin:0.55rem 0 0">Shown with sample content so you can judge the look. Happy with it? Add it to your templates. Want changes? Describe them under "Want changes?". (This demo lives in your Sites list; delete it any time.)</p></div>';
}

async function previewGeneratedLive(siteId) {
  const { status, body } = await api('/v1/sites/' + siteId + '/preview/live', { method: 'POST' });
  if (status === 200 && body.url) window.open(body.url, '_blank', 'noopener');
}

/** All FILE blocks across the conversation; a later path replaces an earlier one. */
function collectFiles() {
  const out = {};
  const re = /^===\s*FILE:\s*(.+?)\s*===\r?\n([\s\S]*?)\r?\n?^===\s*END FILE\s*===/gm;
  for (const m of chat.messages) {
    if (m.role !== 'assistant') continue;
    let hit;
    while ((hit = re.exec(m.content)) !== null) out[hit[1].trim()] = hit[2];
    re.lastIndex = 0;
  }
  return out;
}

function buildGeneratedBundle() {
  const files = collectFiles();
  const manifestSrc = files['manifest.json'];
  if (!manifestSrc) throw new Error('No manifest.json block in the conversation yet, ask the model to deliver the template files.');
  let manifest;
  try { manifest = JSON.parse(manifestSrc); } catch { throw new Error('The manifest.json block is not valid JSON, ask the model to re-send it.'); }
  // The operator names the template; override the AI's suggestion with theirs.
  const chosen = $('#tplName')?.value.trim();
  if (chosen) {
    const slug = chosen.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug) throw new Error('Template name needs at least one letter or number.');
    manifest.name = slug;
  }
  const payload = Object.entries(files)
    .filter(([p]) => p !== 'manifest.json')
    .map(([path, content]) => ({ path: path.replace(/^files\//, ''), content }));
  if (!payload.length) throw new Error('No payload files yet, the template needs its files/ content.');
  return { manifest, files: payload };
}

$('#importGenBtn').addEventListener('click', async () => {
  try {
    const bundle = buildGeneratedBundle();
    setGenResult('<div class="report ok">Adding "' + esc(bundle.manifest.name) + '" to your library…</div>');
    const { status, body } = await api('/v1/templates', { method: 'POST', body: bundle });
    if (status < 300) {
      $('#importGenBtn')?.classList.remove('glow');
      setGenResult('<div class="card gen-done"><div class="done-badge" style="background:var(--good-soft);color:var(--good)">✓ Added to your templates</div>' +
        '<p style="font-size:0.9rem;color:var(--body);margin:0.6rem 0 0">"' + esc(bundle.manifest.name) + '" is ready. Head to <b>Step 2 · Sites</b> to build a client site from it.' +
        (body.warnings?.length ? ' <span style="color:var(--muted)">(' + body.warnings.length + ' minor lint note(s), see Templates.)</span>' : '') + '</p></div>');
    } else {
      const errs = (body.errors || [body.error?.message || 'rejected']).join('\n- ');
      // Queue the fix for the model; the operator sends it with Refine.
      $('#chatText').value = 'The import gate rejected the template with these errors, fix them and re-send only the affected files:\n- ' + errs;
      const rw = $('#refineWrap'); if (rw) rw.hidden = false;
      setGenResult('<div class="report err">The template needs a fix before it can be added:<br>- ' + esc(errs).replace(/\n- /g, '<br>- ') + '<br><br>Press <b>Refine</b> below (the fix request is filled in) and the AI will correct it.</div>');
    }
  } catch (err) {
    setGenResult('<div class="report err">' + esc(err.message) + '</div>');
  }
});

$('#downloadGenBtn').addEventListener('click', () => {
  try {
    const bundle = buildGeneratedBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (bundle.manifest.name || 'template') + '.bundle.json';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    addMsg('systemnote', err.message);
  }
});

$('#clearChatBtn').addEventListener('click', () => {
  chat.messages = [];
  $('#chatlog').innerHTML = '';
  setGenResult('');
  $('#importGenBtn')?.classList.remove('glow');
  const rw = $('#refineWrap'); if (rw) rw.hidden = true;
  ['#brBusiness', '#brColors', '#brAudience', '#brExtra', '#brVibeCustom', '#chatText'].forEach((s) => { const el = $(s); if (el) el.value = ''; });
  currentVibe = ''; renderVibes();
});

/* ══════════════ Sites ══════════════ */
const templateSource = {}; // name -> 'bundled' | 'imported'
async function loadSiteTemplateOptions() {
  const sel = $('#siteTemplateSel');
  if (!getApiKey()) return;
  const { status, body } = await api('/v1/templates');
  if (status !== 200) return;
  const bases = body.templates.filter((t) => t.kind === 'site');
  for (const t of bases) templateSource[t.name] = t.source;
  sel.innerHTML = bases.map((t) => '<option value="' + esc(t.name) + '">' + esc(t.name) + ' (' + esc(t.source) + ')</option>').join('');
  renderAssembleFeatures();
}

/** Module-backed feature toggles. Catalog base: default from the Studio
 *  selection (carry-over). Your own template: default OFF, its features are
 *  already in the design, and modules are opt-in CMS-backed extras. */
function renderAssembleFeatures() {
  const root = $('#assembleFeatures');
  if (!root) return;
  const src = templateSource[$('#siteTemplateSel').value];
  root.innerHTML = FEATURES.filter((f) => f.module).map((f) => {
    const on = src !== 'imported' && enabledFeatures.has(f.id);
    return '<label class="feature' + (on ? ' on' : '') + '"><input type="checkbox" ' + (on ? 'checked' : '') + ' data-assemblefeat="' + f.id + '"> ' + esc(f.label) + '</label>';
  }).join('');
  updateAssembleNote();
}
function updateAssembleNote() {
  const src = templateSource[$('#siteTemplateSel').value];
  const note = $('#assembleFeatureNote');
  const mods = [...document.querySelectorAll('#assembleFeatures input:checked')].map((c) => FEATURE_BY_ID[c.dataset.assemblefeat]?.label).filter(Boolean);
  if (src === 'imported') {
    note.innerHTML = mods.length
      ? 'Layers CMS-backed engine modules onto your template: <b>' + mods.map(esc).join('</b>, <b>') + '</b>. Your template keeps whatever features the AI built into its design.'
      : 'Your template ships with its built-in design. Optionally layer CMS-backed engine modules on top by ticking any above.';
  } else {
    note.innerHTML = mods.length
      ? 'Adds real engine features to this catalog template: <b>' + mods.map(esc).join('</b>, <b>') + '</b>.'
      : 'No add-on features selected, the base template ships as-is.';
  }
}
$('#assembleFeatures').addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-assemblefeat]');
  if (cb) cb.closest('.feature').classList.toggle('on', cb.checked);
  updateAssembleNote();
});
$('#siteTemplateSel').addEventListener('change', renderAssembleFeatures);

async function loadSites() {
  const tbody = $('#sitesTable tbody');
  if (!getApiKey()) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted)">Save an API key to load your sites.</td></tr>';
    return;
  }
  const { status, body } = await api('/v1/sites');
  if (status !== 200) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--bad)">' + (status === 403 ? 'This key lacks the sites scope.' : 'Could not load sites (' + status + ').') + '</td></tr>';
    return;
  }
  if (!body.sites.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted)">No sites yet, assemble your first one above.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  for (const s of body.sites) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td style="color:var(--ink);font-weight:600">' + esc(s.siteName) + '</td>' +
      '<td><code>' + esc(s.templateId) + '</code></td>' +
      '<td>' + esc(s.lastJobStatus || 'not built') + '</td>' +
      '<td style="color:var(--muted)">' + esc((s.updatedAt || '').slice(0, 16).replace('T', ' ')) + '</td>' +
      '<td><button class="ghost" data-site="' + esc(s.id) + '">View</button></td>';
    tbody.appendChild(tr);
  }
}

$('#sitesTable').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-site]');
  if (btn) openSiteDetail(btn.dataset.site);
});

let detailCms = false; // does the open site include the CMS/admin module?

async function openSiteDetail(siteId) {
  const { status, body } = await api('/v1/sites/' + siteId);
  if (status !== 200) return;
  const built = body.jobs.some((j) => j.status === 'done');
  detailCms = Array.isArray(body.config.modules) && body.config.modules.includes('d4-cms-core');
  const jobsHtml = body.jobs.map((j) =>
    '<tr><td><code>' + esc(j.id.slice(0, 8)) + '</code></td><td>' + esc(j.kind) + '</td><td>' + esc(j.status) + '</td><td style="color:var(--muted)">' + esc((j.finishedAt || j.createdAt || '').slice(0, 19).replace('T', ' ')) + '</td></tr>').join('');
  // One "going live" card: what to set on the host to turn on delivery
  // features. Everything here is OPTIONAL, the site works as-is, but this is
  // where the operator learns they CAN wire up email + the admin.
  const goLiveCard = built
    ? '<details class="card" style="margin-top:0.9rem"><summary style="cursor:pointer;font-weight:600;color:var(--ink)">Optional delivery settings (email, admin, database)</summary>' +
        '<p style="font-size:0.84rem;color:var(--body);margin:0.6rem 0 0.55rem">The site works the moment it publishes. These optional environment variables switch on delivery features; they are also listed in the site\'s <code>.env.example</code>. Whoever owns that client\'s hosting sets them there.</p>' +
        '<ul style="font-size:0.83rem;color:var(--body);margin:0;padding-left:1.1rem;display:grid;gap:0.4rem">' +
          '<li><b>Contact-form email.</b> Messages are always saved to the site\'s inbox. To also email the owner on every submission, set <code>RESEND_API_KEY</code> and <code>CONTACT_TO_EMAIL</code> (a <a href="https://resend.com" target="_blank" rel="noopener">Resend</a> key is free to start). This is per-site, set by whoever owns that client\'s hosting.</li>' +
          (detailCms
            ? '<li><b>Admin login.</b> This site has a private admin at <code>/admin</code>. In the live preview the password is <code>preview</code>; on your host set <code>ADMIN_PASSWORD</code> for the real one, plus <code>TOTP_SECRET</code> for two-factor.</li>' +
              '<li><b>Editable content.</b> Use the "Connect the database" step above (any libSQL-compatible endpoint, not just one vendor) so admin edits save; publishing to Vercel wires it in automatically. Other hosts need <code>TURSO_DATABASE_URL</code> + <code>TURSO_AUTH_TOKEN</code> set manually, plus <code>BLOB_READ_WRITE_TOKEN</code> for image uploads.</li>'
            : '') +
        '</ul></details>'
    : '';
  const id = body.id;
  // One step at a time: locked steps hide their body, the active step is open,
  // completed steps show a check. State is reactive (refreshSiteSteps).
  const step = (n, title, bodyHtml, lockedMsg) =>
    '<section class="sstep" data-step="' + n + '">' +
      '<div class="sstep-head"><span class="sstep-num">' + n + '</span>' +
        '<h3>' + title + '</h3><span class="sstep-status" data-role="status"></span></div>' +
      '<div class="sstep-body">' + bodyHtml + '</div>' +
      '<div class="sstep-locked">' + lockedMsg + '</div>' +
    '</section>';
  const buildRow =
    '<div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:center">' +
    '<button class="primary" data-siteact="build" data-id="' + esc(id) + '">' + (built ? 'Rebuild site' : 'Build site') + '</button>' +
    (built ? '<button class="primary" data-siteact="live" data-id="' + esc(id) + '">▶ Open live preview</button>' +
             '<button class="ghost" data-siteact="export" data-id="' + esc(id) + '">Download site (.tar.gz)</button>' : '') +
    '</div>' +
    '<div id="livePreview" style="margin-top:0.6rem"></div>' +
    '<div id="siteActOut" style="margin-top:0.6rem"></div>';
  $('#siteDetail').innerHTML =
    '<h3 style="margin-top:1.2rem;color:var(--ink)">' + esc(body.config.siteName || body.id) + '</h3>' +
    '<div id="siteStepper" class="stepper"></div>' +
    '<div id="sitePreview"></div>' +
    // Step 1 — the intake (answer questions → AI writes the copy)
    step(1, 'The essentials',
      '<p style="font-size:0.85rem;color:var(--muted);margin:0 0 0.2rem">Answer these and the AI writes finished copy for every page, no placeholders.</p>' +
      '<div id="siteContent" data-id="' + esc(id) + '"></div>', '') +
    // Step 2 — photos (encouraged, but skippable)
    step(2, 'Photos &amp; logo',
      '<p style="font-size:0.85rem;color:var(--muted);margin:0 0 0.6rem">Drop each file into the right compartment and it lands in its exact place, no paths to think about. Optional: the AI can generate a hero, and the logo can come later.</p>' +
      '<div id="siteAssets" data-id="' + esc(id) + '" class="grid2"></div>' +
      '<div style="margin-top:0.7rem"><button class="ghost" data-siteact="photos-skip" data-id="' + esc(id) + '">Continue without photos</button></div>',
      'Answer the essentials first, then add photos.') +
    // Step 3 — build
    step(3, built ? 'Rebuild the site' : 'Build the site',
      '<p style="font-size:0.85rem;color:var(--muted);margin:0 0 0.6rem">' + (built ? 'Rebuild to pick up edits or newly added photos.' : 'This assembles the finished, shippable site with real copy and images.') + '</p>' + buildRow,
      'Answer the essentials to unlock the build.') +
    // Step 4 — publish
    step(4, 'Publish',
      (built ? '<div id="launchPanel"></div>' + goLiveCard : ''),
      'Build the site first, then publish it live.') +
    // reference material, kept out of the main flow
    '<details style="margin-top:1.2rem"><summary style="cursor:pointer;color:var(--muted);font-size:0.85rem">Build history &amp; checks</summary>' +
    (jobsHtml ? '<div class="tscroll"><table class="list"><thead><tr><th>Job</th><th>Kind</th><th>Status</th><th>When</th></tr></thead><tbody>' + jobsHtml + '</tbody></table></div>' : '<p style="font-size:0.82rem;color:var(--muted)">No builds yet.</p>') +
    '<div id="siteQa"></div></details>' +
    '<details style="margin-top:0.5rem"><summary style="cursor:pointer;color:var(--muted);font-size:0.85rem">Config (' + Object.keys(body.config).length + ' slots, ' + body.configHistory.length + ' prior versions)</summary>' +
    '<div class="codeblock"><pre>' + esc(JSON.stringify(body.config, null, 2)) + '</pre><button class="copybtn" type="button">Copy</button></div></details>' +
    // Danger zone: delete this site (with typed confirmation).
    '<div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--line)">' +
    '<button class="ghost danger" data-siteact="delete" data-id="' + esc(id) + '" data-name="' + esc(body.config.siteName || body.id) + '">Delete this site…</button>' +
    '<div id="deleteConfirm" style="margin-top:0.6rem"></div></div>';
  // A built site has already cleared essentials + moved past photos.
  stepState = { siteId: id, ready: built, hasPhotos: false, photosAck: built, built };
  refreshSiteSteps();
  loadSiteAssets(body.id);
  loadSiteContent(body.id);
  loadSitePreviewAndQa(body);
  if (built) loadLaunchPanel(body.id);
}

// The 4-step gated flow state for the open site, and its reactive render.
let stepState = null;
function stepStatus(n, s) {
  if (n === 1) return s.ready ? 'done' : 'active';
  if (n === 2) return !s.ready ? 'locked' : (s.hasPhotos || s.photosAck) ? 'done' : 'active';
  if (n === 3) return !s.ready ? 'locked' : s.built ? 'done' : 'active';
  return !s.built ? 'locked' : 'active'; // step 4, publish
}
function refreshSiteSteps() {
  const s = stepState;
  if (!s) return;
  document.querySelectorAll('#siteDetail .sstep').forEach((sec) => {
    const st = stepStatus(Number(sec.dataset.step), s);
    sec.classList.remove('done', 'active', 'locked');
    sec.classList.add(st);
    const pill = sec.querySelector('[data-role="status"]');
    if (pill) pill.textContent = st === 'done' ? '✓ Done' : st === 'active' ? 'Now' : 'Locked';
  });
  const bar = document.getElementById('siteStepper');
  if (bar) bar.innerHTML = ['The essentials', 'Photos & logo', 'Build', 'Publish'].map((label, i) => {
    const st = stepStatus(i + 1, s);
    return '<div class="stepchip ' + st + '"><span class="stepchip-n">' + (st === 'done' ? '✓' : (i + 1)) + '</span><span>' + esc(label) + '</span></div>';
  }).join('');
}

/* ══════════════ Content intake (DFY: facts in → AI writes the site) ══════════════ */
const FACT_SEP = /\s+[—–-]\s+|\s*[|]\s*/; // "Name - Role" / "A | B" splitters

function parseFact(kind, raw) {
  const text = raw || '';
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  switch (kind) {
    case 'list': case 'topics': return lines;
    case 'people': return lines.map((l) => { const [name, role] = l.split(FACT_SEP); return { name: (name || '').trim(), role: (role || '').trim() }; });
    case 'roles': return lines.map((l) => { const [title, ...rest] = l.split(FACT_SEP); return { title: (title || '').trim(), summary: rest.join(' - ').trim() }; });
    case 'products': return lines.map((l) => { const [name, price, ...rest] = l.split(FACT_SEP); return { name: (name || '').trim(), price: (price || '').trim(), note: rest.join(' - ').trim() }; });
    default: return text.trim();
  }
}

function serializeFact(kind, val) {
  if (val == null) return '';
  switch (kind) {
    case 'list': case 'topics': return Array.isArray(val) ? val.join('\n') : '';
    case 'people': return Array.isArray(val) ? val.map((p) => [p.name, p.role].filter(Boolean).join(' - ')).join('\n') : '';
    case 'roles': return Array.isArray(val) ? val.map((r) => [r.title, r.summary].filter(Boolean).join(' - ')).join('\n') : '';
    case 'products': return Array.isArray(val) ? val.map((p) => [p.name, p.price, p.note].filter(Boolean).join(' - ')).join('\n') : '';
    default: return String(val);
  }
}

function factInput(f, val) {
  const req = f.required ? ' <span style="color:var(--bad)">*</span>' : '';
  const help = f.help ? '<p style="font-size:0.76rem;color:var(--muted);margin:0.15rem 0 0.35rem">' + esc(f.help) + '</p>' : '';
  if (f.kind === 'photos') {
    return '<div class="field"><label>' + esc(f.label) + req + '</label>' + help + '<div style="font-size:0.8rem;color:var(--muted)">Add these in the <b>Gallery</b> compartment below.</div></div>';
  }
  const v = esc(serializeFact(f.kind, val));
  const multiline = ['facts', 'list', 'topics', 'people', 'roles', 'products'].includes(f.kind);
  const ph = f.kind === 'people' ? 'One per line:  Name - Role'
    : f.kind === 'roles' ? 'One per line:  Title - one-line summary'
    : f.kind === 'products' ? 'One per line:  Name - Price - note'
    : (f.kind === 'list' || f.kind === 'topics') ? 'One per line'
    : f.kind === 'facts' ? 'Notes are fine, the AI turns them into polished copy' : '';
  const control = multiline
    ? '<textarea data-fact="' + f.id + '" data-kind="' + f.kind + '" rows="' + (f.kind === 'facts' ? 4 : 3) + '" placeholder="' + esc(ph) + '" style="width:100%;font-size:0.85rem">' + v + '</textarea>'
    : '<input data-fact="' + f.id + '" data-kind="' + f.kind + '" type="' + (f.kind === 'email' ? 'email' : f.kind === 'tel' ? 'tel' : 'text') + '" value="' + v + '" style="width:100%">';
  return '<div class="field"><label>' + esc(f.label) + req + '</label>' + help + control + '</div>';
}

function readyBadge(r) {
  if (r.ready) return '<div class="report ok">✓ All essentials answered, this will build a finished, shippable site.</div>';
  return '<div class="report" style="background:var(--warn-soft);color:var(--warn)">' + r.answeredCount + ' of ' + r.requiredCount +
    ' essentials answered. Still needed: <b>' + r.missing.map((m) => esc(m.label)).join(', ') + '</b></div>';
}

async function loadSiteContent(siteId) {
  const root = $('#siteContent');
  if (!root) return;
  const { status, body } = await api('/v1/sites/' + siteId + '/content');
  if (status !== 200) { root.innerHTML = ''; return; }
  const byGroup = {};
  for (const f of body.fields) (byGroup[f.group] = byGroup[f.group] || []).push(f);
  let html = '<h3 style="margin-top:1.4rem;color:var(--ink)">Tell us about the business</h3>' +
    '<p style="font-size:0.85rem;color:var(--muted);margin:0.3rem 0 0.7rem">Answer the essentials (<span style="color:var(--bad)">*</span>) and the AI writes finished copy for every page, no placeholders, nothing left blank. Optional fields add more when you have them.</p>' +
    '<div id="contentReady">' + readyBadge(body.readiness) + '</div>';
  for (const [g, fields] of Object.entries(byGroup)) {
    html += '<div class="card" style="margin-top:0.6rem"><h3 style="margin-top:0">' + esc(body.groups[g] || g) + '</h3>' +
      fields.map((f) => factInput(f, body.facts[f.id])).join('') + '</div>';
  }
  html += '<div style="display:flex;gap:0.6rem;margin-top:0.7rem;flex-wrap:wrap;align-items:center">' +
    '<button class="primary" data-contentact="generate" data-id="' + esc(siteId) + '">✍ Write the copy with AI</button>' +
    '<span style="font-size:0.8rem;color:var(--muted)">Preview the words before you build.</span></div>' +
    '<div id="copyPreview" style="margin-top:0.6rem"></div>';
  root.innerHTML = html;
  if (body.copy) renderCopyPreview(body.copy, 'saved');
  if (stepState && stepState.siteId === siteId) { stepState.ready = Boolean(body.readiness?.ready); refreshSiteSteps(); }
}

let contentSaveTimer = null;
async function saveSiteContent() {
  const siteId = $('#siteContent')?.dataset.id;
  if (!siteId) return;
  const facts = {};
  document.querySelectorAll('#siteContent [data-fact]').forEach((el) => {
    facts[el.dataset.fact] = parseFact(el.dataset.kind, el.value);
  });
  const { status, body } = await api('/v1/sites/' + siteId + '/content', { method: 'PATCH', body: { facts } });
  if (status === 200 && $('#contentReady')) $('#contentReady').innerHTML = readyBadge(body.readiness);
  if (status === 200 && stepState && stepState.siteId === siteId) { stepState.ready = Boolean(body.readiness?.ready); refreshSiteSteps(); }
}

async function generateSiteCopy(siteId) {
  const box = $('#copyPreview');
  box.innerHTML = '<div class="report ok">Writing your copy… the AI is drafting every page from your answers.</div>';
  const { status, body } = await api('/v1/sites/' + siteId + '/content/generate', { method: 'POST' });
  if (status !== 200) { box.innerHTML = '<div class="report err">' + esc(body.error?.message || 'Could not write the copy.') + '</div>'; return; }
  renderCopyPreview(body.copy, body.source);
}

function renderCopyPreview(copy, source) {
  const box = $('#copyPreview');
  if (!box) return;
  const P = (t) => '<p style="margin:0.2rem 0;font-size:0.86rem">' + esc(t) + '</p>';
  const sec = (title, inner) => inner ? '<div style="margin-top:0.55rem"><div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted)">' + esc(title) + '</div>' + inner + '</div>' : '';
  let html = '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem"><h3 style="margin:0">The copy the AI wrote</h3>' +
    '<span style="font-size:0.72rem;color:var(--muted)">' + (source === 'ai' ? 'written by AI' : source === 'saved' ? 'saved draft' : 'auto-composed') + '</span></div>';
  html += sec('Tagline', P(copy.tagline));
  html += sec('Description', P(copy.description));
  if (copy.services?.length) html += sec('Services', '<ul style="margin:0.2rem 0;padding-left:1.1rem;font-size:0.84rem">' + copy.services.map((s) => '<li><b>' + esc(s.name) + '</b>' + (s.description ? ', ' + esc(s.description) : '') + '</li>').join('') + '</ul>');
  if (copy.about?.paragraphs?.length) html += sec('About', copy.about.paragraphs.map(P).join(''));
  if (copy.faq?.length) html += sec('FAQ', copy.faq.map((f) => '<p style="margin:0.3rem 0;font-size:0.84rem"><b>' + esc(f.question) + '</b><br>' + esc(f.answer) + '</p>').join(''));
  if (copy.careers?.roles?.length) html += sec('Roles', '<ul style="margin:0.2rem 0;padding-left:1.1rem;font-size:0.84rem">' + copy.careers.roles.map((r) => '<li><b>' + esc(r.title) + '</b>' + (r.summary ? ', ' + esc(r.summary) : '') + '</li>').join('') + '</ul>');
  html += '<p style="font-size:0.78rem;color:var(--muted);margin-top:0.5rem">This lands on the site when you build. Change any answer above and write it again to update.</p></div>';
  box.innerHTML = html;
}

/** Delete a site, but only after the operator types its name to confirm. */
function showDeleteConfirm(siteId, name) {
  const el = $('#deleteConfirm');
  if (!el) return;
  el.innerHTML =
    '<div class="card" style="margin:0;border-color:var(--bad)">' +
    '<p style="margin:0 0 0.6rem;font-size:0.86rem">This permanently deletes <b>' + esc(name) + '</b> and its build, photos, and history. It cannot be undone.</p>' +
    '<div class="field"><label>Type the site name to confirm</label><input id="delName" placeholder="' + esc(name) + '" spellcheck="false" autocomplete="off"></div>' +
    '<div style="display:flex;gap:0.5rem;margin-top:0.3rem">' +
    '<button class="ghost danger" data-siteact="delete-go" data-id="' + esc(siteId) + '" data-name="' + esc(name) + '">Delete permanently</button>' +
    '<button class="ghost" data-siteact="delete-cancel">Cancel</button></div>' +
    '<div id="delOut" style="margin-top:0.5rem"></div></div>';
  setTimeout(() => $('#delName')?.focus(), 50);
}

async function deleteSiteNow(siteId, name) {
  const typed = $('#delName')?.value.trim();
  if (typed !== name) { $('#delOut').innerHTML = '<div class="report err">The name does not match, so nothing was deleted.</div>'; return; }
  const { status, body } = await api('/v1/sites/' + siteId, { method: 'DELETE' });
  if (status !== 200) { $('#delOut').innerHTML = '<div class="report err">' + esc(body.error?.message || 'Could not delete the site.') + '</div>'; return; }
  $('#siteDetail').innerHTML = '<div class="report ok">Deleted "' + esc(name) + '".</div>';
  loadSites();
}

/** Build (assemble + QA) with visible progress, then refresh the detail. */
async function buildSite(siteId) {
  const out = $('#siteActOut');
  // Nudge: don't let a first build go out with no logo or photos by accident.
  const alreadyBuilt = document.querySelector('[data-siteact="build"]')?.textContent.includes('Rebuild');
  if (!alreadyBuilt) {
    const st = await api('/v1/sites/' + siteId + '/assets');
    const anyAssets = st.status === 200 && Object.values(st.body.assets || {}).some((a) => a && a.length);
    if (!anyAssets) {
      const go = confirm('This site has no logo or photos yet.\n\nOK = build without them\nCancel = go add photos first');
      if (!go) { $('#siteAssets')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    }
  }
  out.innerHTML = '<div class="report ok" style="display:flex;align-items:center;gap:0.5rem"><span class="spin"></span><span>Preparing the site (writing any missing copy)…</span></div>';
  const { status, body } = await api('/v1/sites/' + siteId + '/assemble', { method: 'POST', body: {} });
  if (status !== 202) {
    out.innerHTML = '<div class="report err">' + esc(body.error?.message || 'Build failed to start (' + status + ').') + '</div>';
    if (body.error?.code === 'content_incomplete') $('#siteContent')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const started = Date.now();
  out.innerHTML = '<div class="report ok">Building… full checks take a few minutes.</div>';
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    let j;
    // The heavy build steps briefly block the server, ride through
    // dropped polls instead of silently stopping.
    try { j = await api('/v1/jobs/' + body.jobId); } catch { continue; }
    if (j.status !== 200) continue;
    if (j.body.status === 'done' || j.body.status === 'failed') {
      openSiteDetail(siteId);
      loadSites();
      const failDetail = j.body.status === 'failed' ? buildFailureDetail(j.body) : '';
      setTimeout(() => {
        $('#siteActOut').innerHTML = j.body.status === 'done'
          ? '<div class="report ok">✓ Built and checked, the preview above is the real site' + (j.body.result?.preview ? ', photos included' : '') + '.</div>'
          : '<div class="report err"><b>Build failed.</b> What the build reported:<br><pre style="white-space:pre-wrap;margin:0.4rem 0;font-size:0.78rem;max-height:14rem;overflow:auto">' + esc(failDetail).slice(0, 6000) + '</pre></div>';
      }, 400);
      return;
    }
    const last = j.body.logs?.at(-1)?.line || 'working…';
    const mins = Math.round((Date.now() - started) / 6000) / 10;
    out.innerHTML = '<div class="report ok">Building (' + mins + ' min): ' + esc(last.slice(0, 120)) + '</div>';
  }
}

/** Start (or reuse) a clickable live preview and embed it. `reopenTab` also
 *  pops it in a new browser tab. Runs `next start` on the operator's machine. */
async function openLivePreview(siteId, reopenTab) {
  const box = $('#livePreview');
  if (!reopenTab) box.innerHTML = '<div class="report ok">Starting a live preview server on your machine… the first start takes a few seconds.</div>';
  const { status, body } = await api('/v1/sites/' + siteId + '/preview/live', { method: 'POST' });
  if (status !== 200) {
    box.innerHTML = '<div class="report err">' + esc(body.error?.message || 'Could not start the live preview.') + '</div>';
    return;
  }
  const url = body.url;
  window.open(url, '_blank', 'noopener');
  box.innerHTML =
    '<div class="card" style="margin-top:0.4rem">' +
    '<div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;margin-bottom:0.5rem">' +
    '<span style="color:var(--good);font-weight:600">● Live at <a href="' + esc(url) + '" target="_blank" rel="noopener"><code>' + esc(url) + '</code></a></span>' +
    '<button class="ghost" data-siteact="live-open" data-id="' + esc(siteId) + '">Open in new tab</button>' +
    (detailCms ? '<a class="ghost btnlink" href="' + esc(url) + '/admin" target="_blank" rel="noopener">Open admin (/admin)</a>' : '') +
    '<button class="ghost danger" data-siteact="live-stop" data-id="' + esc(siteId) + '">Stop preview</button>' +
    '</div>' +
    '<p style="font-size:0.8rem;color:var(--muted);margin:0 0 0.5rem">Click through the whole site, every page, with the client\'s real photos. It runs locally and stops on its own after 30 minutes idle.' +
      (detailCms ? ' The admin dashboard is at <code>/admin</code>, sign in with password <code>preview</code>.' : '') + '</p>' +
    '<iframe src="' + esc(url) + '" title="Live preview" style="width:100%;height:70vh;border:1px solid var(--line);border-radius:10px;background:#fff"></iframe>' +
    '</div>';
}

async function stopLivePreview(siteId) {
  await api('/v1/sites/' + siteId + '/preview/live', { method: 'DELETE' });
  const box = $('#livePreview');
  if (box) box.innerHTML = '<div class="report">Live preview stopped.</div>';
}

/**
 * The "Publish this site" panel. One click to a live Vercel URL, or push to
 * GitHub. An agency that hosts every client on its OWN account sets a token
 * once (saved as the default) and never re-enters it: when a default exists we
 * show a ready-to-launch button, and the per-client override is tucked away for
 * the rarer case where the client owns their own hosting.
 */
async function loadLaunchPanel(siteId) {
  const host = document.getElementById('launchPanel');
  if (!host) return;
  let dt = {};
  try { const r = await api('/v1/sites/' + siteId + '/deploy-target'); dt = r.body || {}; } catch { /* fall through to entry fields */ }
  let dbInfo = {};
  if (detailCms) {
    try { const r = await api('/v1/sites/' + siteId + '/database'); dbInfo = r.body || {}; } catch { /* fall through to entry fields */ }
  }
  const vc = dt.vercel || {}; const gh = dt.github || {};
  const vcReady = Boolean(vc.site?.connected || vc.accountDefault);
  const vcVia = vc.site?.connected ? 'this client\'s own Vercel token'
    : vc.accountDefault ? 'your saved Vercel default' : null;
  const ghOwner = gh.site?.owner || gh.accountDefault?.owner || '';
  const ghReady = Boolean(gh.site?.connected || gh.accountDefault);
  const ghVia = gh.site?.connected ? 'this client\'s own GitHub token' : gh.accountDefault ? 'your saved GitHub default' : null;
  const info = (id, text) => '<button class="infoBtn" type="button" data-info="' + id + '" aria-label="What is this?">i</button>' +
    '<div class="tip" id="' + id + '" hidden>' + text + '</div>';

  // ── Vercel: the recommended one-click-to-live path ──
  const vercelBlock =
    '<div class="launchProv">' +
      '<div class="lpHead"><b>Publish to Vercel</b> ' + info('tipVc',
        'A Vercel token lets Stardrive upload the finished site and give you a live URL in about a minute. Create one at <a href="https://vercel.com/account/tokens" target="_blank" rel="noopener">vercel.com/account/tokens</a> (the free Hobby tier works). Save it once as your default and every client site you build reuses it, no re-entering.') +
        ' <span class="lpTag">one click to a live URL</span></div>' +
      (vcReady
        ? '<p class="lpReady">Ready to go using <b>' + esc(vcVia) + '</b>. Publish and this client\'s site goes live under that account.</p>' +
          '<button class="primary" data-siteact="vercel-go" data-id="' + esc(siteId) + '">Publish to Vercel</button>' +
          '<details class="lpOverride"><summary>This client hosts on their own Vercel</summary>' +
            '<div class="field"><label>Their Vercel token</label><input id="vcToken" class="mono" type="password" autocomplete="off"></div>' +
            '<label class="checkline"><input type="checkbox" id="vcSaveSite"> Remember this token for this client only</label>' +
          '</details>'
        : '<div class="field"><label>Vercel token</label><input id="vcToken" class="mono" type="password" placeholder="paste your Vercel token" autocomplete="off"></div>' +
          '<label class="checkline"><input type="checkbox" id="vcSaveDefault" checked> Save as my Vercel default, reuse it for every site I build</label>' +
          '<button class="primary" data-siteact="vercel-go" data-id="' + esc(siteId) + '">Publish to Vercel</button>') +
    '</div>';

  // ── Database: vendor-neutral libSQL connection (CMS sites only) ──
  const dbSite = dbInfo.site; const dbDef = dbInfo.accountDefault;
  const dbReady = Boolean(dbSite?.connected || dbDef);
  const dbVia = dbSite?.connected ? 'this client\'s own database' : dbDef ? 'your saved database default' : null;
  const dbBlock = detailCms
    ? '<div class="launchProv">' +
        '<div class="lpHead"><b>Connect the database</b> ' + info('tipDb',
          'This site\'s admin needs a database to save edits. Any libSQL-compatible endpoint works, this is not locked to one vendor: <a href="https://turso.tech" target="_blank" rel="noopener">Turso</a> is the easiest hosted option (free tier), self-hosted libSQL/SQLite works too. Paste the database URL and its auth token (leave the token blank if your endpoint needs none). Publishing to Vercel wires it in automatically, no manual env vars to copy.') + '</div>' +
        (dbReady
          ? '<p class="lpReady">Using <b>' + esc(dbVia) + '</b>' + (dbSite?.url || dbDef?.url ? ' (' + esc(dbSite?.url || dbDef?.url) + ')' : '') + '. Publishing to Vercel wires it in automatically.</p>' +
            '<details class="lpOverride"><summary>Use a different database for this client</summary>' +
              '<div class="field"><label>Database URL</label><input id="dbUrl" class="mono" placeholder="libsql://your-db.turso.io" spellcheck="false"></div>' +
              '<div class="field"><label>Auth token (leave blank if none needed)</label><input id="dbToken" class="mono" type="password" autocomplete="off"></div>' +
              '<label class="checkline"><input type="checkbox" id="dbSaveSite" checked> Remember this database for this client only</label>' +
              '<div><button class="ghost" data-siteact="db-go" data-id="' + esc(siteId) + '">Save database</button></div>' +
            '</details>'
          : '<div class="field"><label>Database URL</label><input id="dbUrl" class="mono" placeholder="libsql://your-db.turso.io" spellcheck="false"></div>' +
            '<div class="field"><label>Auth token (leave blank if none needed)</label><input id="dbToken" class="mono" type="password" autocomplete="off"></div>' +
            '<label class="checkline"><input type="checkbox" id="dbSaveDefault" checked> Save as my database default, reuse it for every site I build</label>' +
            '<div><button class="ghost" data-siteact="db-go" data-id="' + esc(siteId) + '">Save database</button></div>') +
      '</div>'
    : '';

  // ── GitHub: push the code to any account, connect to any host ──
  const githubBlock =
    '<div class="launchProv">' +
      '<div class="lpHead"><b>Or push to GitHub</b> ' + info('tipGh',
        'Pushes the finished site (a standard Next.js repo, the engine is never included) to a GitHub account you choose. From there connect it to Vercel, Netlify, Cloudflare, or any host. Create a token at <a href="https://github.com/settings/tokens" target="_blank" rel="noopener">github.com/settings/tokens</a> with repo scope. Save it once and reuse it for every site.') + '</div>' +
      '<div class="grid2">' +
        '<div class="field"><label>GitHub owner (user or org)</label><input id="ghOwner" class="mono" value="' + esc(ghOwner) + '" placeholder="e.g. ada-web-co" spellcheck="false"></div>' +
        '<div class="field"><label>Repository name</label><input id="ghRepo" class="mono" placeholder="defaults to the site name" spellcheck="false"></div>' +
      '</div>' +
      (ghReady
        ? '<p class="lpReady">Using <b>' + esc(ghVia) + '</b>' + (ghOwner ? ' (' + esc(ghOwner) + ')' : '') + '. Leave the token blank to reuse it.</p>' +
          '<details class="lpOverride"><summary>Use a different GitHub token for this client</summary>' +
            '<div class="field"><label>Their GitHub token</label><input id="ghToken" class="mono" type="password" autocomplete="off"></div>' +
            '<label class="checkline"><input type="checkbox" id="ghSaveSite"> Remember this token for this client only</label>' +
          '</details>'
        : '<div class="field"><label>GitHub token</label><input id="ghToken" class="mono" type="password" placeholder="paste your GitHub token" autocomplete="off"></div>' +
          '<label class="checkline"><input type="checkbox" id="ghSaveDefault" checked> Save as my GitHub default, reuse it for every site I build</label>') +
      '<div style="margin-top:0.5rem"><button class="ghost" data-siteact="github-go" data-id="' + esc(siteId) + '">Push to GitHub</button></div>' +
    '</div>';

  host.innerHTML =
    '<div class="card launch">' +
      '<h3 style="margin:0 0 0.2rem">🚀 Publish this site</h3>' +
      '<p style="font-size:0.84rem;color:var(--body);margin:0 0 0.9rem">Take this finished site live. Set a token once and it becomes your default for every client, so you never enter it twice. Override per client only when they host it themselves.</p>' +
      vercelBlock + dbBlock + githubBlock +
      '<div id="launchOut" style="margin-top:0.7rem"></div>' +
    '</div>';
}

async function publishVercel(siteId) {
  const out = $('#launchOut');
  const token = $('#vcToken')?.value.trim() || '';
  const saveDefault = $('#vcSaveDefault')?.checked;
  const saveSite = $('#vcSaveSite')?.checked;
  out.innerHTML = '<div class="report ok">Publishing to Vercel, uploading and building. This can take a minute…</div>';
  // Saving as the account default (agency mode) stores it once for every site.
  if (token && saveDefault) {
    const s = await api('/v1/connections/vercel', { method: 'PUT', body: { token } });
    if (s.status !== 200) { out.innerHTML = '<div class="report err">' + esc(s.body.error?.message || 'Could not save the Vercel token.') + '</div>'; return; }
  }
  const payload = {};
  if (token) payload.token = token;
  if (saveSite) payload.save = true;
  const { status, body } = await api('/v1/sites/' + siteId + '/deploy/vercel', { method: 'POST', body: payload });
  out.innerHTML = status === 200
    ? '<div class="report ok">✓ ' + esc(body.note || 'Published to Vercel.') + (body.url ? ' Live at <a href="' + esc(body.url) + '" target="_blank" rel="noopener">' + esc(body.url) + '</a>.' : '') + (body.inspectorUrl ? ' <a href="' + esc(body.inspectorUrl) + '" target="_blank" rel="noopener">Build logs</a>.' : '') + '</div>'
    : '<div class="report err">' + esc(body.error?.message || 'Publish failed (' + status + ').') + '</div>';
}

async function deployGithub(siteId) {
  const out = $('#launchOut');
  const owner = $('#ghOwner')?.value.trim() || '';
  const repo = $('#ghRepo')?.value.trim() || '';
  const token = $('#ghToken')?.value.trim() || '';
  const saveDefault = $('#ghSaveDefault')?.checked;
  const saveSite = $('#ghSaveSite')?.checked;
  out.innerHTML = '<div class="report ok">Pushing the site to GitHub…</div>';
  if (token && saveDefault) {
    const s = await api('/v1/connections/github', { method: 'PUT', body: { token, ...(owner ? { owner } : {}) } });
    if (s.status !== 200) { out.innerHTML = '<div class="report err">' + esc(s.body.error?.message || 'Could not save the GitHub token.') + '</div>'; return; }
  }
  const payload = {};
  if (owner) payload.owner = owner;
  if (repo) payload.repo = repo;
  if (token) payload.token = token;
  if (saveSite) payload.save = true;
  const { status, body } = await api('/v1/sites/' + siteId + '/deploy', { method: 'POST', body: payload });
  out.innerHTML = status === 200
    ? '<div class="report ok">✓ Pushed to <a href="' + esc(body.url) + '" target="_blank" rel="noopener">' + esc(body.repo) + '</a> (' + body.files + ' files' + (body.createdRepo ? ', repo created' : '') + '). ' + esc(body.note) + '</div>'
    : '<div class="report err">' + esc(body.error?.message || 'Push failed (' + status + ').') + '</div>';
}

/** Save a database connection (vendor-neutral libSQL: url + optional auth
 *  token). Not a deploy itself, publishing to Vercel wires it in after. */
async function saveDatabase(siteId) {
  const out = $('#launchOut');
  const url = $('#dbUrl')?.value.trim() || '';
  const authToken = $('#dbToken')?.value.trim() || '';
  const saveDefault = $('#dbSaveDefault')?.checked;
  const saveSite = $('#dbSaveSite')?.checked;
  if (!url) { out.innerHTML = '<div class="report err">A database URL is required (libsql://… or https://…).</div>'; return; }
  out.innerHTML = '<div class="report ok">Saving the database connection…</div>';
  if (saveDefault) {
    const s = await api('/v1/connections/turso', { method: 'PUT', body: { token: authToken, url } });
    if (s.status !== 200) { out.innerHTML = '<div class="report err">' + esc(s.body.error?.message || 'Could not save the database.') + '</div>'; return; }
  }
  if (saveSite) {
    const s = await api('/v1/sites/' + siteId + '/database', { method: 'POST', body: { url, authToken } });
    if (s.status !== 200) { out.innerHTML = '<div class="report err">' + esc(s.body.error?.message || 'Could not save the database.') + '</div>'; return; }
  }
  await loadLaunchPanel(siteId);
  const out2 = $('#launchOut');
  if (out2) out2.innerHTML = '<div class="report ok">✓ Database connected. Publishing to Vercel will wire it in automatically, no manual env vars.</div>';
}

/** Visual preview (full-QA screenshot) + the latest job's QA report. */
async function loadSitePreviewAndQa(site) {
  // Preview image, if the full QA tier captured one.
  try {
    const res = await fetch('/v1/sites/' + site.id + '/preview', { headers: { Authorization: 'Bearer ' + getApiKey() } });
    if (res.ok) {
      const url = URL.createObjectURL(await res.blob());
      $('#sitePreview').innerHTML =
        '<div style="margin:0.6rem 0 0.9rem"><img src="' + url + '" alt="Site preview" style="max-width:100%;border:1px solid var(--line);border-radius:10px"><div style="font-size:0.75rem;color:var(--muted);margin-top:0.3rem">Home-page snapshot from the last build. Press <b style="color:var(--ink)">Open live preview</b> to click through the whole site.</div></div>';
    }
  } catch { /* no preview, fine */ }
  // QA report of the most recent finished job.
  const last = [...(site.jobs || [])].reverse().find((j) => j.status === 'done' || j.status === 'failed');
  if (!last) return;
  const { status, body } = await api('/v1/jobs/' + last.id);
  const qa = status === 200 ? body.result?.qa : null;
  if (!qa?.checks?.length) return;
  $('#siteQa').innerHTML =
    '<details style="margin-top:0.8rem"' + (qa.verdict !== 'passed' ? ' open' : '') + '><summary style="cursor:pointer;font-size:0.85rem;color:' + (qa.verdict === 'passed' ? 'var(--good)' : 'var(--warn)') + '">QA (' + esc(qa.mode) + '): ' + esc(qa.verdict) + ', ' + qa.checks.filter((c) => c.status === 'pass').length + '/' + qa.checks.length + ' checks</summary>' +
    '<ul style="list-style:none;margin:0.5rem 0 0;padding:0;display:grid;gap:0.25rem;font-size:0.82rem">' +
    qa.checks.map((c) => '<li>' + (c.status === 'pass' ? '<span style="color:var(--good)">✓</span> ' : '<span style="color:var(--bad)">✗</span> ') + esc(c.name) + (c.detail ? ' <span style="color:var(--muted)">· ' + esc(c.detail) + '</span>' : '') + '</li>').join('') +
    '</ul></details>';
}

async function loadSiteAssets(siteId) {
  const root = $('#siteAssets');
  if (!root) return;
  const { status, body } = await api('/v1/sites/' + siteId + '/assets');
  if (status !== 200) { root.innerHTML = '<div class="report err">Could not load assets (' + status + ').</div>'; return; }
  root.innerHTML = '';
  for (const slot of body.slots) {
    const items = body.assets[slot.id] || [];
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<h3 style="margin-top:0">' + esc(slot.label) + ' <span style="color:var(--muted);font-weight:400;font-size:0.78rem">' + items.length + ' / ' + slot.max + (slot.declaredBy ? ' · from ' + esc(slot.declaredBy) : '') + '</span></h3>' +
      '<p style="font-size:0.8rem;color:var(--muted);margin:0.2rem 0 0.6rem">' + esc(slot.description) + ' <span style="font-family:var(--mono);font-size:0.72rem">→ ' + esc(slot.target) + '</span></p>' +
      (items.length ? '<ul style="list-style:none;margin:0 0 0.6rem;padding:0;display:grid;gap:0.35rem">' + items.map((a) =>
        '<li style="display:flex;align-items:center;gap:0.5rem;font-size:0.82rem"><code>' + esc(a.filename) + '</code>' +
        '<span style="color:var(--muted)">' + Math.max(1, Math.round(a.bytes / 1024)) + ' KB</span>' +
        '<button class="ghost danger" data-assetdel="' + esc(a.id) + '" data-slot="' + esc(slot.id) + '" style="margin-left:auto;padding:0.1rem 0.5rem;font-size:0.72rem">Remove</button></li>').join('') + '</ul>' : '') +
      (items.length < slot.max
        ? '<input type="file" data-upload="' + esc(slot.id) + '" accept="' + slot.accept.map((e) => '.' + e).join(',') + '" style="font-size:0.78rem;max-width:100%">'
        : '<div style="font-size:0.78rem;color:var(--muted)">Compartment full.</div>');
    root.appendChild(card);
  }
  if (stepState && stepState.siteId === siteId) {
    stepState.hasPhotos = body.slots.some((slot) => (body.assets[slot.id] || []).length > 0);
    refreshSiteSteps();
  }
}

$('#view-sites').addEventListener('change', async (e) => {
  const input = e.target.closest('input[data-upload]');
  if (!input || !input.files.length) return;
  const siteId = $('#siteAssets').dataset.id;
  const file = input.files[0];
  if (file.size > 8_000_000) { alert('Files must be at most 8 MB.'); input.value = ''; return; }
  const b64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const { status, body } = await api('/v1/sites/' + siteId + '/assets/' + input.dataset.upload, {
    method: 'POST', body: { filename: file.name, contentBase64: b64 },
  });
  if (status !== 201) alert(body.error?.message || 'Upload failed (' + status + ').');
  loadSiteAssets(siteId);
});

// Debounced auto-save of the content intake as the operator types.
$('#siteDetail').addEventListener('input', (e) => {
  if (!e.target.matches('[data-fact]')) return;
  clearTimeout(contentSaveTimer);
  contentSaveTimer = setTimeout(saveSiteContent, 700);
});

$('#siteDetail').addEventListener('click', async (e) => {
  const del = e.target.closest('button[data-assetdel]');
  if (del) {
    const siteId = $('#siteAssets').dataset.id;
    await api('/v1/sites/' + siteId + '/assets/' + del.dataset.slot + '/' + del.dataset.assetdel, { method: 'DELETE' });
    loadSiteAssets(siteId);
    return;
  }
  const cbtn = e.target.closest('button[data-contentact]');
  if (cbtn) {
    if (cbtn.dataset.contentact === 'generate') generateSiteCopy(cbtn.dataset.id);
    return;
  }
  const infoBtn = e.target.closest('button[data-info]');
  if (infoBtn) {
    const tip = document.getElementById(infoBtn.dataset.info);
    if (tip) tip.hidden = !tip.hidden;
    return;
  }
  const btn = e.target.closest('button[data-siteact]');
  if (!btn) return;
  if (btn.dataset.siteact === 'build') { buildSite(btn.dataset.id); return; }
  if (btn.dataset.siteact === 'photos-skip') {
    if (stepState) { stepState.photosAck = true; refreshSiteSteps(); }
    document.querySelector('#siteDetail .sstep[data-step="3"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (btn.dataset.siteact === 'delete') { showDeleteConfirm(btn.dataset.id, btn.dataset.name); return; }
  if (btn.dataset.siteact === 'delete-cancel') { const el = $('#deleteConfirm'); if (el) el.innerHTML = ''; return; }
  if (btn.dataset.siteact === 'delete-go') { deleteSiteNow(btn.dataset.id, btn.dataset.name); return; }
  if (btn.dataset.siteact === 'live') { openLivePreview(btn.dataset.id); return; }
  if (btn.dataset.siteact === 'live-stop') { stopLivePreview(btn.dataset.id); return; }
  if (btn.dataset.siteact === 'live-open') { openLivePreview(btn.dataset.id, true); return; }
  if (btn.dataset.siteact === 'vercel-go') { publishVercel(btn.dataset.id); return; }
  if (btn.dataset.siteact === 'github-go') { deployGithub(btn.dataset.id); return; }
  if (btn.dataset.siteact === 'db-go') { saveDatabase(btn.dataset.id); return; }
  if (btn.dataset.siteact === 'export') {
    // Real export streams a .tar.gz, fetch with auth and trigger a download.
    const res = await fetch('/v1/sites/' + btn.dataset.id + '/export', { headers: { Authorization: 'Bearer ' + getApiKey() } });
    if (res.ok) {
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'site.tar.gz';
      a.click();
      URL.revokeObjectURL(a.href);
      $('#siteActOut').innerHTML = '<div class="report ok">Downloaded the assembled site, a standalone Next.js project (the engine is never included).</div>';
    } else {
      const body = await res.json().catch(() => ({}));
      $('#siteActOut').innerHTML = '<div class="report" style="background:var(--warn-soft);color:var(--warn)">' + esc(body.error?.message || 'Export unavailable.') + '</div>';
    }
    return;
  }
});

$('#assembleBtn').addEventListener('click', async () => {
  const out = $('#assembleOut');
  const templateId = $('#siteTemplateSel').value;
  const siteName = $('#siteNameInput').value.trim();
  if (!getApiKey()) { out.innerHTML = '<div class="report err">Save an API key first (top right).</div>'; return; }
  if (!templateId || !siteName) { out.innerHTML = '<div class="report err">Pick a base template and give the site a name.</div>'; return; }
  const config = { siteName };
  const tagline = $('#siteTaglineInput').value.trim();
  if (tagline) config.tagline = tagline;
  // Feature toggles → real engine modules, layered onto the base at assembly
  // (catalog templates AND your own imported templates alike).
  const mods = [...document.querySelectorAll('#assembleFeatures input:checked')]
    .map((c) => FEATURE_BY_ID[c.dataset.assemblefeat]?.module).filter(Boolean);
  if (mods.length) config.modules = mods;
  // Create WITHOUT building: photos go in first so the first build's
  // preview shows the client's real images.
  const { status, body } = await api('/v1/sites', { method: 'POST', body: { templateId, config, assemble: false } });
  if (status !== 201) {
    out.innerHTML = '<div class="report err">' + esc(body.error?.message || 'Could not create the site (' + status + ').') + '</div>';
    return;
  }
  out.innerHTML = '<div class="report ok">✓ Created, now add the client\'s photos below, then press <b>Build site</b>.</div>';
  $('#siteNameInput').value = ''; $('#siteTaglineInput').value = '';
  loadSites();
  openSiteDetail(body.siteId);
  setTimeout(() => $('#siteDetail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
});

/* ══════════════ Connections ══════════════ */
async function loadConnections() {
  if (!getApiKey()) { $('#connNote').innerHTML = '<div class="report err">Save an API key first (top right).</div>'; return; }
  const { status, body } = await api('/v1/connections');
  if (status !== 200) {
    $('#connNote').innerHTML = '<div class="report err">' + (status === 403 ? 'This key lacks the deploy scope, mint one with --scopes mappings,templates,sites,deploy.' : 'Could not load connections (' + status + ').') + '</div>';
    return;
  }
  $('#connNote').innerHTML = '';
  for (const card of document.querySelectorAll('#connGrid .card')) {
    const c = body.connections[card.dataset.provider];
    card.querySelector('[data-role="status"]').style.display = c.connected ? '' : 'none';
    card.querySelector('[data-act="disconnect"]').style.display = c.connected ? '' : 'none';
    card.querySelector('[data-role="state"]').textContent = c.connected
      ? 'Connected · ' + (c.url ? c.url + ' · ' : '') + (c.last4 ? 'ends in ' + c.last4 + ' · ' : '') + (c.owner ? c.owner + ' · ' : '') + 'saved ' + (c.updatedAt || '').slice(0, 10)
      : 'Not connected.';
  }
}

$('#connGrid').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const card = btn.closest('.card');
  const provider = card.dataset.provider;
  if (btn.dataset.act === 'save') {
    const token = card.querySelector('[data-role="token"]').value.trim();
    const owner = card.querySelector('[data-role="owner"]')?.value.trim();
    const url = card.querySelector('[data-role="url"]')?.value.trim();
    const { status, body } = await api('/v1/connections/' + provider, { method: 'PUT', body: { token, ...(owner ? { owner } : {}), ...(url ? { url } : {}) } });
    if (status === 200) {
      card.querySelector('[data-role="token"]').value = '';
      flash(btn, 'Saved ✓');
      loadConnections();
    } else {
      $('#connNote').innerHTML = '<div class="report err">' + esc(body.error?.message || 'Save failed (' + status + ').') + '</div>';
    }
  }
  if (btn.dataset.act === 'disconnect') {
    if (!confirm('Disconnect ' + provider + '? Deploys will need it re-added.')) return;
    await api('/v1/connections/' + provider, { method: 'DELETE' });
    loadConnections();
  }
});

/* ══════════════ API Reference ══════════════ */
const REF = [
  { group: 'Getting oriented', items: [
    { m: 'GET', p: '/v1/health', d: 'Service status. No key needed.', curl: `curl {BASE}/v1/health` },
    { m: 'GET', p: '/v1', d: 'Lists the whole surface. No key needed.', curl: `curl {BASE}/v1` },
  ]},
  { group: 'Mappings, your questionnaire, declaratively', items: [
    { m: 'POST', p: '/v1/mappings/validate', d: 'Full-report validation of a mapping document.',
      curl: `curl -X POST {BASE}/v1/mappings/validate \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d @my-mapping.json` },
    { m: 'POST', p: '/v1/intake/parse', d: 'Run answers through a mapping (inline or stored) → proposed site config.',
      curl: `curl -X POST {BASE}/v1/intake/parse \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d '{"mappingId":"my-intake","answers":{"Q1":"Acme Fixture Works"}}'` },
    { m: 'PUT', p: '/v1/mappings/{id}', d: 'Store a mapping by id (validated; private to your account).',
      curl: `curl -X PUT {BASE}/v1/mappings/my-intake \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d @my-mapping.json` },
    { m: 'GET', p: '/v1/mappings', d: 'List your stored mappings.', curl: `curl {BASE}/v1/mappings -H "Authorization: Bearer {KEY}"` },
    { m: 'DELETE', p: '/v1/mappings/{id}', d: 'Delete a stored mapping.', curl: `curl -X DELETE {BASE}/v1/mappings/my-intake -H "Authorization: Bearer {KEY}"` },
  ]},
  { group: 'Templates, the shared catalog + your private imports', items: [
    { m: 'GET', p: '/v1/templates', d: 'The bundled d4 catalog plus your imports.', curl: `curl {BASE}/v1/templates -H "Authorization: Bearer {KEY}"` },
    { m: 'GET', p: '/v1/templates/{name}', d: 'Full manifest (and import warnings, for yours).', curl: `curl {BASE}/v1/templates/d4-site-template -H "Authorization: Bearer {KEY}"` },
    { m: 'POST', p: '/v1/templates', d: 'Import a template bundle {manifest, files[]}. Errors reject; warnings import. Private to your account.',
      curl: `curl -X POST {BASE}/v1/templates \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d @my-template.bundle.json` },
    { m: 'POST', p: '/v1/templates/validate', d: 'Validate a manifest alone (no import).',
      curl: `curl -X POST {BASE}/v1/templates/validate \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d '{"manifest":{"name":"my-template","version":"1.0.0","kind":"site","description":"…","provides":{"routes":["/"],"nav":[],"adminPanels":[],"collections":[]},"copy":[{"from":"files","to":"."}]}}'` },
    { m: 'DELETE', p: '/v1/templates/{name}', d: 'Delete one of YOUR imports (the shared catalog is protected).', curl: `curl -X DELETE {BASE}/v1/templates/my-template -H "Authorization: Bearer {KEY}"` },
  ]},
  { group: 'Sites & jobs, assemble, watch, change', items: [
    { m: 'POST', p: '/v1/sites', d: 'Assemble from explicit config, or mappingId+answers in one step. Returns an async job.',
      curl: `curl -X POST {BASE}/v1/sites \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d '{"templateId":"d4-site-template","config":{"siteName":"Acme Fixture Works","modules":["d4-cms-core"]}}'` },
    { m: 'GET', p: '/v1/jobs/{id}', d: 'Job status + logs + the QA report.', curl: `curl {BASE}/v1/jobs/{jobId} -H "Authorization: Bearer {KEY}"` },
    { m: 'GET', p: '/v1/sites', d: 'List your sites (yours alone), newest first.', curl: `curl {BASE}/v1/sites -H "Authorization: Bearer {KEY}"` },
    { m: 'GET', p: '/v1/sites/{id}', d: 'Site record: config, history, job summaries.', curl: `curl {BASE}/v1/sites/{siteId} -H "Authorization: Bearer {KEY}"` },
    { m: 'POST', p: '/v1/sites/{id}/change', d: 'Shallow config delta → re-assemble; history kept.',
      curl: `curl -X POST {BASE}/v1/sites/{siteId}/change \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d '{"config":{"tagline":"A new line."}}'` },
    { m: 'GET', p: '/v1/sites/{id}/assets', d: 'The site’s asset compartments (standard + template-declared) and what’s in them.', curl: `curl {BASE}/v1/sites/{siteId}/assets -H "Authorization: Bearer {KEY}"` },
    { m: 'POST', p: '/v1/sites/{id}/assets/{slot}', d: 'Upload into a compartment (logo, favicon, hero, about, gallery, team, misc, …), slotted to its exact site path at the next assembly.',
      curl: `curl -X POST {BASE}/v1/sites/{siteId}/assets/logo \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d '{"filename":"logo.svg","contentBase64":"…"}'` },
    { m: 'DELETE', p: '/v1/sites/{id}/assets/{slot}/{assetId}', d: 'Remove an uploaded asset.', curl: `curl -X DELETE {BASE}/v1/sites/{siteId}/assets/logo/{assetId} -H "Authorization: Bearer {KEY}"` },
    { m: 'POST', p: '/v1/sites/{id}/assemble', d: 'Re-assemble with the current config + latest assets.', curl: `curl -X POST {BASE}/v1/sites/{siteId}/assemble -H "Authorization: Bearer {KEY}" -d '{}'` },
    { m: 'POST', p: '/v1/sites/{id}/deploy', d: 'Push the finished site to GitHub (this request > this site\'s saved target > your account default).', curl: `curl -X POST {BASE}/v1/sites/{siteId}/deploy -H "Authorization: Bearer {KEY}" -d '{}'` },
    { m: 'POST', p: '/v1/sites/{id}/deploy/vercel', d: 'One-click publish to Vercel and get a live URL (token: request > site > account default). Auto-wires a connected database as Vercel env vars.', curl: `curl -X POST {BASE}/v1/sites/{siteId}/deploy/vercel -H "Authorization: Bearer {KEY}" -d '{}'` },
    { m: 'GET', p: '/v1/sites/{id}/database', d: 'This site\'s database target (masked) and your account default.', curl: `curl {BASE}/v1/sites/{siteId}/database -H "Authorization: Bearer {KEY}"` },
    { m: 'POST', p: '/v1/sites/{id}/database', d: 'Connect this site to a libSQL database (vendor-neutral: any libsql://, https://, or file: endpoint — Turso is just the recommended hosted one).',
      curl: `curl -X POST {BASE}/v1/sites/{siteId}/database \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d '{"url":"libsql://your-db.turso.io","authToken":"YOUR_TOKEN"}'` },
    { m: 'GET', p: '/v1/sites/{id}/export', d: 'Export the assembled repo as a .tar.gz (a standalone Next.js project; the engine is never included).', curl: `curl {BASE}/v1/sites/{siteId}/export -H "Authorization: Bearer {KEY}"` },
  ]},
  { group: 'Connections, your hosting, your site', items: [
    { m: 'GET', p: '/v1/connections', d: 'Which providers are connected (masked, tokens are never returned).', curl: `curl {BASE}/v1/connections -H "Authorization: Bearer {KEY}"` },
    { m: 'PUT', p: '/v1/connections/{provider}', d: 'Save your own vercel | turso | github credentials as your account default (encrypted at rest; deploys receive only the assembled site, never the engine). "turso" is a generic libSQL database connection, not vendor-exclusive — pass {url, token} for any libsql/https/file endpoint.',
      curl: `curl -X PUT {BASE}/v1/connections/vercel \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d '{"token":"YOUR_VERCEL_TOKEN"}'` },
    { m: 'DELETE', p: '/v1/connections/{provider}', d: 'Disconnect a provider.', curl: `curl -X DELETE {BASE}/v1/connections/vercel -H "Authorization: Bearer {KEY}"` },
  ]},
  { group: 'Account', items: [
    { m: 'GET', p: '/v1/usage', d: 'This key’s monthly counters (failed calls are never metered).', curl: `curl {BASE}/v1/usage -H "Authorization: Bearer {KEY}"` },
    { m: 'POST', p: '/workbench/chat', d: 'The Template Studio relay, runs on Stardrive’s own model (included; no model key from you). Send { system, messages }.',
      curl: `curl -X POST {BASE}/workbench/chat \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d '{"messages":[{"role":"user","content":"hi"}]}'` },
  ]},
];

function renderReference() {
  const root = $('#refRoot');
  const key = getApiKey() || 'sk_live_YOUR_KEY';
  root.innerHTML = '';
  for (const g of REF) {
    const h = document.createElement('div');
    h.className = 'refgroup';
    h.textContent = g.group;
    root.appendChild(h);
    for (const ep of g.items) {
      const d = document.createElement('details');
      d.className = 'endpoint';
      d.innerHTML =
        '<summary><span class="badge method ' + ep.m.toLowerCase() + '">' + ep.m + '</span> ' + esc(ep.p) +
        '<span class="desc">' + esc(ep.d) + '</span></summary>' +
        '<div class="body"><div class="codeblock"><pre>' +
        esc(ep.curl.replaceAll('{BASE}', location.origin).replaceAll('{KEY}', key)) +
        '</pre><button class="copybtn" type="button">Copy</button></div></div>';
      root.appendChild(d);
    }
  }
}
renderReference();
$('#saveKeyBtn').addEventListener('click', renderReference);

/* ══════════════ Keys & usage ══════════════ */
$('#testKeyBtn').addEventListener('click', async () => {
  const out = $('#usageOut');
  if (!getApiKey()) { out.innerHTML = '<div class="report err">Save a key first (top right).</div>'; return; }
  const { status, body } = await api('/v1/usage');
  if (status !== 200) { out.innerHTML = '<div class="report err">Key rejected (' + status + ').</div>'; return; }
  const rows = Object.entries(body.counters || {}).sort()
    .map(([k, v]) => '<tr><td><code>' + esc(k) + '</code></td><td style="text-align:right;font-variant-numeric:tabular-nums">' + v + '</td></tr>').join('');
  out.innerHTML =
    '<div class="report ok">✓ Key valid, <b>' + esc(body.name) + '</b> · account <code>' + esc(body.account) + '</code> · period ' + esc(body.period) + '</div>' +
    '<div class="tscroll"><table class="list"><thead><tr><th>Counter</th><th style="text-align:right">This period</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="2" style="color:var(--muted)">No usage yet this period.</td></tr>') + '</tbody></table></div>';
});

/* ══════════════ Self-service keys ══════════════ */
async function loadKeys() {
  const tbody = $('#keysTable tbody');
  const res = await fetch('/v1/keys');
  if (!res.ok) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--bad)">Log in to manage keys.</td></tr>'; return; }
  const { keys } = await res.json();
  if (!keys.length) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted)">No keys yet, create one above.</td></tr>'; return; }
  tbody.innerHTML = '';
  for (const k of keys) {
    const tr = document.createElement('tr');
    const status = k.revoked ? '<span style="color:var(--bad)">revoked</span>' : '<span style="color:var(--good)">active</span>';
    tr.innerHTML =
      '<td style="color:var(--ink)">' + esc(k.name) + '</td>' +
      '<td style="font-size:0.78rem">' + esc((k.scopes || []).join(', ')) + '</td>' +
      '<td style="color:var(--muted)">' + esc((k.createdAt || '').slice(0, 10)) + '</td>' +
      '<td>' + status + '</td>' +
      '<td style="white-space:nowrap">' + (k.revoked ? '' :
        '<button class="ghost" data-keyact="rotate" data-id="' + esc(k.id) + '">Rotate</button> ' +
        '<button class="ghost danger" data-keyact="revoke" data-id="' + esc(k.id) + '">Revoke</button>') + '</td>';
    tbody.appendChild(tr);
  }
}

$('#createKeyBtn').addEventListener('click', async () => {
  const name = $('#newKeyName').value.trim() || 'key';
  const scopes = [...document.querySelectorAll('#scopeChecks input:checked')].map((c) => c.value);
  const res = await fetch('/v1/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, scopes }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { $('#newKeyOut').innerHTML = '<div class="report err">' + esc(body.error?.message || 'Failed.') + '</div>'; return; }
  $('#newKeyName').value = '';
  $('#newKeyOut').innerHTML = '<div class="keyreveal">Key <b>' + esc(body.name) + '</b> created, copy it now, it will not be shown again.<code>' + esc(body.secret) + '</code></div>';
  loadKeys();
});

$('#keysTable').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-keyact]');
  if (!btn) return;
  if (btn.dataset.keyact === 'rotate') {
    const res = await fetch('/v1/keys/' + btn.dataset.id + '/rotate', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      $('#newKeyOut').innerHTML = '<div class="keyreveal">Rotated <b>' + esc(body.name) + '</b>, the old secret is now dead. New secret (shown once):<code>' + esc(body.secret) + '</code></div>';
      if (getApiKey() && confirm('Use this rotated key as the active console key too?')) {
        localStorage.setItem('sd.apiKey', body.secret); $('#apiKeyInput').value = body.secret; renderMaskedKey();
      }
    }
    loadKeys();
  }
  if (btn.dataset.keyact === 'revoke') {
    if (!confirm('Revoke this key? Anything using it will stop working.')) return;
    await fetch('/v1/keys/' + btn.dataset.id, { method: 'DELETE' });
    loadKeys();
  }
});

/* ══════════════ Keys & usage (product-key test) ══════════════ */
$('#testKeyBtn').addEventListener('click', async () => {
  const out = $('#usageOut');
  if (!getApiKey()) { out.innerHTML = '<div class="report err">No key active, create one below or paste one up top.</div>'; return; }
  const { status, body } = await api('/v1/usage');
  if (status !== 200) { out.innerHTML = '<div class="report err">Key rejected (' + status + ').</div>'; return; }
  const rows = Object.entries(body.counters || {}).sort()
    .map(([k, v]) => '<tr><td><code>' + esc(k) + '</code></td><td style="text-align:right;font-variant-numeric:tabular-nums">' + v + '</td></tr>').join('');
  out.innerHTML =
    '<div class="report ok">✓ Key valid, <b>' + esc(body.name) + '</b> · period ' + esc(body.period) + '</div>' +
    '<div class="tscroll"><table class="list"><thead><tr><th>Counter</th><th style="text-align:right">This period</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="2" style="color:var(--muted)">No usage yet this period.</td></tr>') + '</tbody></table></div>';
});

/* ══════════════ Billing ══════════════ */
const fmtTokens = (n) => n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);

async function loadBilling() {
  const res = await fetch('/v1/billing');
  if (!res.ok) { $('#planName').textContent = 'log in to view'; return; }
  const b = await res.json();
  const q = b.quota;
  $('#planName').textContent = b.planLabel + (b.plan === 'beta' ? ' · founding beta (free)' : '');

  // Usage meter.
  const pct = q.includedTokens ? Math.min(100, Math.round((q.usedTokens / q.includedTokens) * 100)) : 0;
  $('#usageBar').innerHTML =
    '<div class="meterlabel"><span>Template-generation tokens</span><span class="used">' + fmtTokens(q.usedTokens) + ' / ' + fmtTokens(q.includedTokens) + '</span></div>' +
    '<div class="meter' + (q.over ? ' over' : '') + '"><span style="width:' + pct + '%"></span></div>' +
    '<p style="font-size:0.78rem;color:var(--muted);margin:0.4rem 0 0">' +
      (q.over ? 'Included tokens used up. ' + (q.overageActive ? 'Extra usage is on, you can keep generating.' : 'Turn on extra usage or upgrade to keep generating.')
              : fmtTokens(q.remainingTokens) + ' tokens left this period.') +
    (q.includedAssemblies != null ? ' · ' + q.usedAssemblies + ' / ' + q.includedAssemblies + ' assemblies' : ' · assemblies included') + '</p>';

  // Overage toggle (only meaningful when the plan offers it).
  $('#overageArea').innerHTML = q.overageOffered
    ? '<label class="toggle"><input type="checkbox" id="overageToggle"' + (q.overageEnabled ? ' checked' : '') + '> Keep generating past my tokens (extra usage billed to my card at $' + q.overagePer1kUsd.toFixed(3) + '/1k)</label>' +
      '<p id="overageNote" style="font-size:0.78rem;color:var(--muted);margin:0.4rem 0 0">' + (b.checkoutConfigured ? '' : 'Saved as a preference now; activates once a card is on file.') + '</p>'
    : '<p style="font-size:0.8rem;color:var(--muted);margin:0">This plan has no extra-usage option, upgrade for overage and more tokens.</p>';
  const tog = $('#overageToggle');
  if (tog) tog.addEventListener('change', async () => {
    const r = await fetch('/v1/billing/overage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: tog.checked }) });
    const body = await r.json().catch(() => ({}));
    $('#overageNote').textContent = body.note || '';
  });

  $('#checkoutArea').innerHTML = b.checkoutConfigured ? ''
    : '<div class="report" style="background:var(--code-bg);color:var(--muted);margin-top:0.9rem">Checkout isn\'t live yet, founding beta is free. When Stripe is connected, the buttons below start real subscriptions and extra-usage billing.</div>';

  // Plan grid.
  $('#planGrid').innerHTML = b.plans.map((p) => {
    const isNow = p.id === b.plan;
    const perBuild = p.priceUsd > 0 ? '$' + p.effectivePerBuildUsd.toFixed(2) + '/site' : 'free';
    const overBuild = p.overagePer1kUsd != null ? ' · then $' + (p.overagePer1kUsd * 20).toFixed(2) + '/site' : '';
    return '<div class="plan' + (isNow ? ' current' : '') + (p.popular ? ' popular' : '') + '">' +
      (p.popular ? '<span class="pop">Popular</span>' : '') +
      '<h3>' + esc(p.label) + '</h3>' +
      '<div class="price">' + (p.priceUsd > 0 ? '$' + p.priceUsd + '<small>/mo</small>' : '$0') + '</div>' +
      '<div class="rate">' + perBuild + overBuild + '</div>' +
      '<ul>' +
        '<li>~' + p.approxBuilds + ' finished sites/mo</li>' +
        '<li>' + (p.heroImage ? 'AI hero images on every build' : 'Designed template hero images') + '</li>' +
        '<li>Unlimited builds, previews &amp; deploys</li>' +
        '<li>' + (p.overagePer1kUsd != null ? 'Extra sites available (opt-in)' : 'Hard cap (no surprise charges)') + '</li>' +
      '</ul>' +
      '<div class="blurb">' + esc(p.blurb) + '</div>' +
      (isNow ? '<div class="isnow">Your plan</div>'
             : (p.priceUsd > 0 ? '<button class="primary" data-upgrade="' + p.id + '" type="button">Choose ' + esc(p.label) + '</button>' : '')) +
      '</div>';
  }).join('');

  const tbody = $('#usageTable tbody');
  const totals = Object.entries(b.usage?.totals || {}).sort();
  tbody.innerHTML = totals.length
    ? totals.map(([k, v]) => '<tr><td><code>' + esc(k) + '</code></td><td style="text-align:right;font-variant-numeric:tabular-nums">' + v + '</td></tr>').join('')
    : '<tr><td colspan="2" style="color:var(--muted)">No usage yet' + (b.usage?.period ? ' for ' + esc(b.usage.period) : '') + '.</td></tr>';
}

$('#planGrid').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-upgrade]');
  if (!btn) return;
  const r = await fetch('/v1/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: btn.dataset.upgrade }) });
  const body = await r.json().catch(() => ({}));
  if (r.ok && body.url) { location.href = body.url; return; }
  $('#checkoutArea').innerHTML = '<div class="report" style="background:var(--code-bg);color:var(--muted);margin-top:0.9rem">' + esc(body.error?.message || 'Checkout unavailable.') + '</div>';
});

/* ══════════════ Rulebook ══════════════ */
$('#rulebookPre').textContent = RULEBOOK_PROMPT;

/* ══════════════ Boot: gate on session ══════════════ */
(async () => {
  const account = await whoami();
  if (account) { showApp(account); renderMaskedKey(); route(); }
  else { showGate(); }
})();
