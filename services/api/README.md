# @stardrive/api

The Stardrive API, v1 — the product surface described in
[docs/api-design.md](../../docs/api-design.md) — **plus the Workbench**, the
web console it serves at `/` (see `app/workbench/`). Zero runtime
dependencies: `node:http` is the whole stack, state is file-backed JSON
under `var/` (interface-compatible with a later Turso swap), and the
field-mapping engine is imported directly from `packages/field-mapping`.

## Run (and see it)

```
node server.mjs [--port 4650]
```

Then open **http://localhost:4650** (the root redirects to the Console):

- **/** — redirects to `/workbench/`. The public marketing site is a separate
  deployment (built with Stardrive itself), not bundled here. The
  `POST /site/request-access` lead endpoint (per-IP throttled, leads land in
  `var/leads/`) remains available for an external marketing site to post to.
- **/workbench/** — the customer console (`app/workbench/`). It opens a
  **login / signup** gate: sign up with an email + password and the console
  creates your account, opens a session, and mints your first API key
  automatically (shown once). Inside: overview, your private template
  library with folder upload, the Template Studio (chat against the
  authoring rulebook — runs on the operator's own model key server-side, so
  customers bring no model key; dormant until `STARDRIVE_LLM_KEY` is set),
  **Sites** (assemble, watch jobs, read QA reports,
  and upload into **asset compartments** — named slots like
  logo/favicon/hero/gallery, each mapped to its exact path on the assembled
  site; templates can declare extras via manifest `assetSlots`),
  **Connections** (your own Vercel/Turso/GitHub tokens — encrypted at rest,
  masked on read, used only at deploy time), the API reference with
  copy-ready curls, self-service **Keys** (create/rotate/revoke), **Billing**
  (plan + usage; Stripe checkout dormant until configured), and the rulebook.

```
node test/e2e.mjs        # the full end-to-end suite (spawns its own servers)
node test/ops.mjs        # the watchdog: fake clock, fake mailer, fake queue
```

`make-key.mjs` still works for minting a key from the CLI (CI, scripts):
`node scripts/make-key.mjs --name "ci" [--scopes …] [--account <id>]`.

## Accounts, sessions, and keys

**Signup** creates an account (email + scrypt-hashed password) and opens a
browser **session** (an httpOnly cookie; only the token's sha256 is stored).
The account OWNS its API keys and its private library. Two auth layers:

- **API key** (`Authorization: Bearer sk_live_…`) — the machine license, for
  calling the product API (`/v1/*`) from scripts and pipelines.
- **Session** (cookie) — the human login, for the console's account
  management: `GET /auth/me`, self-service keys (`GET/POST /v1/keys`,
  `POST /v1/keys/:id/rotate`, `DELETE /v1/keys/:id`), and billing.

Imported templates, stored mappings, and sites/jobs are private to the
account that created them — the bundled d4 catalog is the only shared
surface. Keys minted with `--account <id>` share one account (CI key beside
a dashboard key); without it each new key gets its own fresh account.

Environment: `PORT`, `STARDRIVE_VAR_DIR` (runtime state; default `./var`,
never committed), `STARDRIVE_ENGINE` (`dry` default | `real` — real invokes
the vendored d4 assembler in `vendor/d4`),
`RATE_LIMIT_PER_MIN` (per key, default 120), `STARDRIVE_SECRET` (encryption
key for stored hosting tokens; a `var/secret.key` is generated for dev if
unset — production must set it), `STARDRIVE_SECURE_COOKIES=1` (adds `Secure`
to the session cookie; set in production behind HTTPS). Billing is dormant
until `STRIPE_SECRET_KEY` (+ `STRIPE_PRICE_<PLAN>` price ids) are set.

## What is implemented (all E2E-tested over real HTTP)

- **Auth**: `Authorization: Bearer sk_live_…`; keys stored hashed (sha256),
  compared timing-safely, scoped (`mappings`, `templates`, `sites`,
  `deploy`), revocable (`make-key.mjs --revoke <id>`).
- **Rate limiting**: continuous-refill token bucket per key; 429 +
  `Retry-After`.
- **Metering**: per-key monthly counters (`GET /v1/usage`) — failed calls
  are never metered.
- **Mappings**: `POST /v1/mappings/validate`, `POST /v1/intake/parse`
  (inline or stored mapping), stored-mapping CRUD
  (`PUT|GET|DELETE /v1/mappings/{id}`, `GET /v1/mappings`).
- **Templates**: `GET /v1/templates` (the six bundled d4 manifests — see
  `data/README.md` for provenance), `GET /v1/templates/{name}`,
  `POST /v1/templates/validate` (full-report manifest validation; the
  `d4-` name prefix is first-party-only, licensee slugs are free-form).
- **Sites + jobs**: `POST /v1/sites` (explicit config, or
  `mappingId`+`answers` for parse-and-assemble in one step; base template
  must be `kind:"site"`), async job lifecycle (`GET /v1/jobs/{id}`), the
  change loop (`POST /v1/sites/{id}/change` — shallow delta, config history
  kept), asset compartments (`/v1/sites/{id}/assets…`), re-assemble.
- **The real engine** (`STARDRIVE_ENGINE=real`): the vendored d4 assembler
  (`vendor/d4`) runs in an isolated per-job workspace and produces a genuine
  standalone Next.js site — base template + selected modules, per-client
  config + theme baked in, uploaded assets slotted into place. Engine
  **modules layer onto a customer's OWN imported template too**: it is staged
  as the base beside the real modules and run through the same assembler, so
  dependency resolution, route-conflict checks, and per-client config all
  apply (an imported template with no modules is materialized directly). A
  real QA gate runs (structural checks + WCAG contrast on the validated
  palettes); QA-red fails the job — never a fake pass. `GET
  /v1/sites/{id}/export` streams the assembled repo as a `.tar.gz` (the site
  ONLY — the engine is never included). The `dry` engine remains for
  tooling-free testing (marker + `skipped` QA).

- **The full QA tier** (`STARDRIVE_QA=full`, opt-in): on top of the
  structural gate, each assembly runs `npm install` → `next build` (the real
  compile gate — proving the template + module combination genuinely
  builds) → serves the production build → checks every declared route →
  axe accessibility (serious/critical fail) → 375px overflow → console
  errors — and captures a screenshot served at
  `GET /v1/sites/{id}/preview` (shown in the Workbench site detail).
  QA-red still fails the job. Verified end-to-end through the API: 12/12
  checks on a real assembled site. (War story: the default QA port was
  4190, which the WHATWG fetch spec silently blocks — "bad port" — so the
  prober now skips fetch-blocked ports.)
- **Deploy**: `POST /v1/sites/{id}/deploy` pushes the assembled site (only)
  to a repo the customer owns via their connected **GitHub** token; link it
  to Vercel and it builds on push. One-click Vercel/Turso provisioning is
  the next integration.
- **Billing**: signature-verified Stripe **webhook** (`POST /webhooks/stripe`)
  flips plans on subscribe/cancel; checkout + webhook are dormant until the
  Stripe keys are set. Token quotas + opt-in overage are enforced now.
- **Email**: welcome + lead notifications via Resend, dormant until
  `RESEND_API_KEY`. **Fair-use** caps per-generation input.

## Honest gaps (pending, by design)

- One-click **Vercel/Turso** provisioning (deploy pushes to GitHub today).
- Full **browser QA** (headless build + axe/Playwright) as a tier on top of
  the structural gate, behind an opt-in flag.
- Turso-backed store · container orchestration · live-key activation of
  Studio/Stripe/email (the seams are built and tested dormant).
