# Stardrive — Roadmap

Milestones toward a sellable 1.0. Estimates are focused build sessions, not
calendar time; Deneb4's own client work takes priority (its launch funds
this). **Pivoted API-first 2026-07-16** (see README "Why API-first") — the
former Electron/installer milestones are superseded.

## M0 — Scaffold (DONE 2026-07-16)
Repo, vision, architecture, and the template-author contract committed.

## M1 — The field-mapping layer (DONE 2026-07-16)
The one genuinely new engineering piece: `packages/field-mapping`, a
declarative format a licensee fills out once, mapping THEIR intake
questionnaire's fields onto THEIR template's build-config slots — replacing
per-form hand-written parsers with a generic engine a non-engineer can
configure. Built inside Deneb4 first, exactly as planned: Deneb4's two
hand-synchronized intake parsers (live form + CSV) now run on one mapping
file, with golden-parity regression tests against the original parser's
captured outputs, 21 generic engine tests, a worked example mapping, and a
full authoring spec (the package README). Pure ESM, zero dependencies —
runs server-side, in a CLI, or in a browser preview.

## M2 — The Stardrive API (~8–14 sessions; FOUNDATION SHIPPED 2026-07-16)
`services/api` per `docs/api-design.md`.

**Done (24-check E2E suite over real HTTP, zero runtime deps):**
- API-key auth (hashed keys, timing-safe compare, scopes, revocation via
  `make-key.mjs`), per-key token-bucket rate limiting (429 + Retry-After),
  per-key monthly usage metering (`GET /v1/usage`; failures never metered).
- The M1 engine live as a service: `POST /v1/mappings/validate`,
  `POST /v1/intake/parse`, stored-mapping CRUD.
- Templates: the six bundled d4 manifests (provenance-tracked, boot-time
  self-validation) + `POST /v1/templates/validate` implementing the
  manifest schema (licensee names free-form; `d4-` prefix first-party only).
- Sites + jobs: assemble from explicit config OR parse-and-assemble
  (`mappingId`+`answers`), async job store surviving restarts, the change
  loop with config history — all against the **dry engine** (workspace
  marker + QA recorded as `skipped`, never passed).
- Honest 501s where work remains: template import, deploy, export.

**Remaining for M2:**
- The real engine executor: d4-site-builder + the verify battery in an
  isolated per-job workspace (changes `lib/jobs.mjs`, not the API surface).
  Requires an engine-repos packaging decision (vendored checkout vs. git
  fetch at job time).
- Deploy with licensee Vercel/Turso/GitHub tokens; export tarball.
- Template import (git URL/tarball) + contrast validation on palettes.
- Webhooks (`job.completed`, `job.failed`, `usage.threshold`).
- Turso-backed store swap; container packaging; CORS for the Workbench.

## M3 — Sellable 1.0 (~6–12 sessions + owner tasks)
- ~~The Workbench~~ — **v1 SHIPPED 2026-07-17**, served by the API itself at
  `/` (zero build step, zero deps): developer-console UI (overview,
  private template library with folder-upload import, API reference with
  live copy-ready curls, keys & usage, the embedded rulebook) plus the
  **Template Studio** — a BYO-key chat (OpenAI-compatible or Anthropic;
  the licensee's provider key relays per-request, never stored) that
  generates templates against the rulebook system prompt and imports them
  through the standard gate, with rejection errors fed back into the chat
  for the model to fix. Browser-smoke-tested end to end. Multi-tenancy
  landed with it: accounts on keys; templates/mappings/sites/jobs private
  per account, catalog shared. Remaining Workbench work: mapping editor,
  client-facts form, build/QA/deploy status views (with the real engine).
- **Customer-facing side v1 SHIPPED 2026-07-17**: the public marketing site
  at `/` (app/site — deliberate night-sky identity, how-it-works, pillars,
  Studio story, honest private-beta pricing card, FAQ incl. the
  engine-invisibility promise, request-access form → `var/leads/` with
  per-IP throttle); the Workbench moved to `/workbench/` and grew the
  customer flow: **Sites** (assemble from any template via UI, watch the
  job, read the QA report, honest 501s for preview/deploy) and
  **Connections** (BYO Vercel/Turso/GitHub tokens, AES-256-GCM at rest,
  masked reads, per-account). Doctrine hardened in api-design.md: customers
  own their sites and hosting tiers; the engine is NEVER visible — exports/
  deploys carry assembled output only. 43-check E2E + 8-step browser smoke.
- **Accounts + self-service SHIPPED 2026-07-17**: email/password **signup &
  login** (scrypt, httpOnly session cookies), the Workbench gated behind it,
  self-service **API key** management from the console (create / rotate /
  revoke — no more CLI minting required; `make-key.mjs` remains for CI), and
  a **Billing** tab (plan + usage aggregated across the account's keys).
  Signup mints the account's first full-scope key automatically. 51-check
  E2E + 11-step browser smoke.
- **Payments**: decided — **Stripe** (checkout). Built as a dormant seam
  (`POST /v1/billing/checkout` → honest 501 until `STRIPE_SECRET_KEY` +
  `STRIPE_PRICE_<PLAN>` are set), so real pricing can be chosen from beta
  usage first, then activated with no code change.
- ~~Key issuance, rotation, scoping; rate limits~~ — **done** (self-service
  above; rate limits already live).
- Docs polished for strangers; a worked example template + mapping.
- stardrive.dev marketing site — build it WITH the d4 engine (dogfood + demo).
- ~~Installer packaging + code signing~~ — eliminated by the API-first pivot.

## M4 — First licensees
One friendly beta agency building a real template + mapping against the
contracts with zero hand-holding; fix everything that breaks. Only after
that: wider sales. A desktop/on-prem wrapper returns to the table only if
beta licensees demand offline builds.

## Standing rules
- Nothing Deneb4-specific (pricing, clients, branding) ever enters the
  engine repos or this product.
- Every capability stays contract-driven (manifest / theme tokens /
  field mapping / panel registry) — a hardcoded assumption today is porting
  work tomorrow.
- `packages/field-mapping` is developed in the Deneb4 repo (where its
  golden-parity tests live against real production fixtures) and extracted
  here on change. One direction only: Deneb4 → here.
