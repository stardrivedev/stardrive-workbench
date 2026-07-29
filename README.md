# Stardrive

**The d4 site engine, sold as a product.** A freelancer or agency signs up and
turns a client's answers into a finished, standalone Next.js site: designed,
themed, content-filled, QA'd, published to hosting they own, and handed over
with a page the client can actually follow. Drive it from the Workbench (the
web console in `app/workbench/`) or from your own pipeline over the same REST
API. The deterministic builder behind Deneb4's studio work, productized.

Domain: **stardrive.dev** · Status: **pre-launch**.

## What it does

The job runs in five steps, which is also how the console is laid out.

1. **Design a template.** Describe the business and the look in a guided
   brief; the AI Studio returns a complete, working template that follows the
   authoring rulebook so it always builds. Or upload your own repo, or start
   from the bundled catalog. Templates are reusable across clients, and your
   own designs can be reopened and refined later.
2. **Build a client's site.** Name the business, upload their logo and photos,
   choose the sections it needs. The assembler is deterministic: no model
   involved, no surprises. You get a QA report and a live preview.
3. **Fill in what only the client can give you.** Most settings are generated
   and managed, including the `/admin` password. A few genuinely belong to the
   client (an email API key, where enquiries should go), and each site states
   exactly what is still outstanding, with the consequence of leaving it.
4. **Publish to hosting you own.** Vercel, Netlify or a GitHub push, using
   **your** credentials so every client can live in their own account. Attach
   their domain. Or export the project with a Dockerfile and run it anywhere.
5. **Hand it over.** A printable page written for the client rather than for a
   developer: where to sign in, the password, and what each part of their
   admin does.

**Batch Building** (Agency tier) runs that whole pipeline for a list of
clients at once, overnight on the provider's Batch API, and gives you a
contact sheet to approve or reject before anything is published.

## Design decisions worth knowing

**API-first, not desktop** (decided 2026-07-16). Previously planned as
installable Electron software. Agencies with recurring volume want the engine
inside their own intake → build → deploy pipeline, so an API key is the
product and the console is a convenience over it. This also deletes a whole
cost class: no installer packaging, no Authenticode certificates, no Apple
notarization, no auto-updates. The trade-off is no offline story, and
Stardrive absorbs build compute. The engine stays separable, so a desktop
wrapper can return if on-prem demand appears.

**The builder, not the agency.** Stardrive is template → client facts →
assembled site → QA → publish. It is deliberately not Deneb4's agency-ops
layer (agents, client portal, pipeline). A licensee runs their own business;
Stardrive builds their clients' sites.

**Dormant, never fake.** Every capability that needs a third-party credential
works dormant and lights up when the credential appears. Without one it
returns an honest 501 naming what is missing, rather than pretending. That
applies to model generation, email, Stripe, and every hosting provider.

**Facts, not invention.** The copy writer is given the licensee's answers and
is not permitted to assert anything it was not told. A business that did not
say it has been trading since 1994 does not get a website claiming it has.

## Architecture

```
Licensee's own systems ──── API key ────┐
Workbench console (app/workbench) ──────┤
                                        ▼
                          Stardrive API (services/api)
                            ├─ Accounts    signup, sessions, password reset,
                            │              scoped API keys, rate limits
                            ├─ Mappings    validate / parse intake answers
                            │              └─ packages/field-mapping
                            ├─ Templates   bundled catalog + your imports,
                            │              validated on the spot (manifest
                            │              schema, theme tokens, contrast)
                            ├─ Studio      guided brief → template, via the
                            │              operator's model key
                            ├─ Sites       assemble → vendor/d4 builder
                            │              (deterministic; no model)
                            ├─ QA          routes, links, a11y and contrast,
                            │              mobile overflow, console errors
                            ├─ Batch       many clients at once, with a
                            │              review gate before publishing
                            ├─ Publish     YOUR Vercel / Netlify / GitHub /
                            │              Turso credentials, plus domains
                            ├─ Handoff     client-facing printable page
                            ├─ Billing     four tiers, quotas, opt-in overage
                            └─ Ops         health, watchdog, alerting, backups
```

Zero runtime dependencies: the service is `node:http` and the standard
library. State is a file-backed store behind a four-verb interface, so moving
to a hosted database later does not touch the routes.

## Contracts that make third-party templates possible

- **Manifest contract** — every template and module declares what it provides
  (routes, nav, admin panels, collections, env) and what it requires.
  Conflicts are detected at assembly. See `docs/template-author-contract.md`.
- **Theme-token contract** — a small set of CSS custom properties any
  compliant template consumes; light and dark palettes are checked for WCAG
  contrast before use.
- **Field-mapping contract** — a declarative JSON document mapping *your*
  questionnaire onto *your* template's config slots, authored once, by a
  non-engineer. See `packages/field-mapping/README.md`.
- **Admin-panel plugin API** — templates ship their own dashboard editors and
  the generated registry wires them in.

## Repository layout

- `services/api/` — the Stardrive API: 96 routes, and the suites below
- `app/workbench/` — the web console: Studio, Sites, Batch Building, site
  settings, handoff, the going-live guide, plan and usage
- `vendor/d4/` — the vendored engine: the builder, the base site template,
  the CMS core, and thirteen feature modules (gallery, blog, shop, careers,
  bookings, testimonials, team, locations and hours, events, menus, payments,
  newsletter, legal pages)
- `packages/field-mapping/` — the declarative intake→config engine
- `packages/template-kit/` — the shared template validation kit
- `docs/` — deployment runbook, roadmap, API design, author contract, legal

## Tests

```
npm test --prefix services/api          # every suite, with a summary
```

Sixteen suites. The browser tier needs Playwright and skips cleanly without
it:

```
STARDRIVE_PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs \
  node services/api/test/run-all.mjs
```

Several exist to stop one specific bug coming back, so it is worth knowing
what they hold:

- `e2e.mjs` — 92 checks over real HTTP against a real server: the whole site
  lifecycle on the actual engine, account isolation, rate limiting, and every
  honest 501
- `backup-restore.mjs` — a restore *drill*. Build real state, snapshot,
  destroy it, restore, and prove the encrypted hosting tokens still decrypt,
  and that the wrong secret fails loudly rather than silently
- `console-a11y.mjs` — axe over every console view in both themes, plus
  keyboard reach and visible focus
- `console-responsive.mjs` — no horizontal overflow at 375, 414, 768 or 1280,
  and the narrow-screen navigation contract
- `console-states.mjs` — what the console says when it is empty, when it is
  waiting, and when it cannot reach the server at all
- `handoff-ui.mjs`, `batch-ui.mjs`, `studio-ui.mjs` — the three flows a
  licensee actually performs, in a real browser
- `proof-run.mjs` — the real engine and the full QA tier end to end (npm
  install, next build, serve, check every route). Slow, needs the network, and
  not in the default run: `npm run test:proof --prefix services/api`

## Running it

```
node services/api/server.mjs            # http://localhost:4650/workbench/
```

`--port 0` takes any free port and prints which one. See `docs/DEPLOYMENT.md`
for the container, the environment, backups, and the monitoring endpoints.

## Honest state of things

The product is built and covered. What remains before taking money is mostly
operational, and one part of it deserves stating plainly: **no code path has
yet run against a live Stripe, Vercel, GitHub, Resend, or Batch API.** Each is
written against a seam and tested with a fake, which proves the wiring and not
the provider. Those round trips, and a small beta soak, are what stand between
here and self-serve signup. See `docs/ROADMAP.md`.

## Provenance

Built on the d4 engine developed for and battle-tested by
[Deneb4 LLC](https://deneb4.com). Stardrive Technology and Deneb4 are the same
ownership: Deneb4 is the studio, Stardrive is the engine as a product.
