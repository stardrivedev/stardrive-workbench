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

**Real engine SHIPPED 2026-07-18** (packaging decision: **vendored, pinned** —
`vendor/d4`, chosen over git-fetch for determinism, engine-invisibility, and
hermetic offline builds):
- `STARDRIVE_ENGINE=real` runs the vendored d4 assembler in an isolated
  per-job workspace → a genuine standalone Next.js site (base + modules,
  per-client config/theme baked in, uploaded assets slotted). Imported
  customer templates are materialized directly.
- Real QA gate: structural checks + WCAG contrast on the validated palettes;
  QA-red fails the job, never a fake pass.
- `GET /v1/sites/{id}/export` → real `.tar.gz` of the assembled repo (site
  only; engine never included). Verified: standard `tar` unpacks a 59-file
  Next.js project with the per-client name baked in.

**Remaining for M2:**
- ~~Deploy with licensee Vercel/Turso/GitHub tokens~~ — **SHIPPED 2026-07-22**:
  one-click publish to Vercel (upload + deploy via the Vercel API, a
  connected database auto-wired in as project env vars, no manual copying),
  push to GitHub (any owner/repo, connect it to any host after), and a
  vendor-neutral database connection (any libSQL-compatible endpoint, Turso
  recommended but not required, self-hosted/no-auth endpoints supported).
- **Vendor-neutral hosting (Ridhi, 2026-07-22): one-click publish is
  currently Vercel-only.** She wants this NOT locked to Vercel: an agency
  should be able to deploy just about anywhere, ideally everywhere, not only
  Vercel-or-GitHub-then-connect-elsewhere. Scope: additional one-click deploy
  targets (Netlify, Cloudflare Pages, Railway, Render are the obvious next
  candidates) behind the same per-site/per-account connection pattern already
  built for Vercel/GitHub/database, so an agency picks its host rather than
  being steered to one. GitHub push already reaches "any host" in two steps
  (push, then connect); this item is about collapsing that to one click for
  more than just Vercel. See `docs/DIFFERENTIATION.md` for why this matters:
  it's a named, honest gap versus our own "vendor-neutral" positioning.
- Full browser QA tier (headless build + axe/Playwright) behind an opt-in flag.
- Webhooks (`job.completed`, `job.failed`, `usage.threshold`, Stripe).
- Turso-backed store swap; container packaging; CORS for the Workbench.
- Vendor-neutral image storage for the CMS: uploads currently use Vercel
  Blob specifically, so a CMS site hosted elsewhere has a broken upload
  feature until this gets the same treatment as the database did.

## M3 — Sellable 1.0 (~6–12 sessions + owner tasks)
- ~~The Workbench~~ — **v1 SHIPPED 2026-07-17**, served by the API itself at
  `/` (zero build step, zero deps): developer-console UI (overview,
  private template library with folder-upload import, API reference with
  live copy-ready curls, keys & usage, the embedded rulebook) plus the
  **Template Studio** — a chat that generates templates against the rulebook
  system prompt and imports them through the standard gate, with rejection
  errors fed back into the chat for the model to fix. (Originally BYO-key;
  **changed 2026-07-17** to run on the OPERATOR's server-side model key so
  customers bring no model key — generation is an included, metered feature.)
  Browser-smoke-tested end to end. Multi-tenancy
  landed with it: accounts on keys; templates/mappings/sites/jobs private
  per account, catalog shared. Remaining Workbench work: mapping editor,
  client-facts form, build/QA/deploy status views (with the real engine).
- **Gated Sites flow SHIPPED 2026-07-22**: the site-detail page is now a
  4-step progressive-disclosure flow (Essentials -> Photos -> Build ->
  Publish) with a visible stepper; locked steps hide their body until their
  prerequisite is met, so a user is never overwhelmed and always sees which
  step they are on. Photos are encouraged but skippable; the template's
  designed hero is the fallback (no image is generated) and an uploaded image,
  when present, becomes the hero background. Front-end only, derived from
  readiness/assets/build state already fetched.
- **Batch Building (Agency tier) SHIPPED 2026-07-23.** The highest tier queues
  N template+site builds and runs them in one go through the model provider's
  **Batch API** (roughly half the token cost, async completion within ~24h).
  The user submits a batch, closes the laptop, and returns to every build
  done, QA'd, and ready to publish. This is the Agency tier's flagship perk:
  it trades interactivity for cost + volume, which is exactly the agency
  use case (many client sites, not one at a time). Completion rides the
  existing webhooks seam (`job.completed`/`job.failed`, M2) plus email, so a
  batch notifies when it lands. Interactive single builds stay on the live
  model; batch is a separate, opt-in submission path.
- **Batch intake parity SHIPPED 2026-07-27.** A batched site now carries the
  same intake a hand-built one does, because it ships to a client the same
  way: the guided design brief the Studio asks for (one `composeBrief()`
  shared by both), the feature set, the **full fact set `content.mjs`
  requires** for those features, and the client's **photos and logo**, staged
  against the draft row and adopted onto the site the instant the batch
  creates it. Submission is readiness-gated per build exactly like the
  interactive assemble, and reports every unanswered question across every
  row at once, before a single provider token is spent, so an overnight run
  can never come back thin. The build list itself is a server-saved DRAFT
  (`batches/draft/{account}.json`), so a stack of twenty is filled in across
  sessions and machines; rows collapse to a one-line summary with a live
  readiness pill, and duplicate / apply-features-to-all / paste-from-a-
  spreadsheet turn a list of clients into a queue in one pass. New surface:
  `GET /v1/content/fields` (the intake schema for a build with no site yet),
  `GET|PUT|DELETE /v1/batches/draft`, and per-row asset staging under
  `/v1/batches/draft/rows/{rowId}/assets`.
- **Custom domains SHIPPED 2026-07-27.** The last mile of every client job,
  built host-agnostic because the whole premise is that the studio owns its
  hosting. The domain is plain data on the site (`site.domain`), not a
  property of one provider. Where Stardrive holds a token for the host it
  attaches the domain, polls verification, and reads the required DNS records
  BACK from that host (never a hardcoded IP that can go stale); Vercel is
  implemented, and `lib/domains.mjs` is the seam for the next one. Everywhere
  else, Stardrive records the domain and shows the record SHAPE plus the
  handoff text, saying plainly that the values come from your host, because
  inventing DNS for a host we cannot see would be worse than useless.
  Publishing also sets `NEXT_PUBLIC_SITE_URL`, which `robots.ts` and
  `sitemap.ts` already read: without it a site on a custom domain keeps
  advertising the wrong canonical host to search engines.
- **Batch Building: review, bulk, and reuse SHIPPED 2026-07-27.**
  - **A blocking design review.** A batch invents designs nobody has seen, so
    each one lands in `review` and its site cannot be published until the
    operator approves it. The gate lives at the deploy actuators, not only in
    the Batch screen, or it would be theatre. A contact sheet shows every
    design side by side; Discard deletes that site and the template that build
    generated. A build made from a template the operator already owns skips
    review, because that design was reviewed when it was imported.
  - **Bulk actions.** Publish every approved site in one detached run
    (progress on the batch record, one failure never stops the rest), and
    download the whole batch as one archive with a directory per site.
  - **Build from an existing template.** A row can name a template instead of
    a brief: no design request is sent at all, so ten franchise sites cost
    half as much, finish sooner, and look like one brand.
- **Studio: work that persists SHIPPED 2026-07-27.** The design and its refine
  conversation autosave server-side (`studio/draft/{account}.json`), compacted
  first because every generation is a whole template. A template in the
  library reopens in the Studio to be refined instead of being frozen at
  import (`GET /v1/templates/{name}?include=files`, own templates only).
  Design demos are flagged `preview` and kept out of the Sites list, which is
  the client roster, and each new demo supersedes the last instead of piling
  up whole workspaces. The library itself is now a grid of screenshots
  (captured by the full QA tier, with a lettered plate when there is none),
  so twenty generated designs are finally distinguishable.
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
- **Pricing model SHIPPED 2026-07-18**: token-based tiers (Free / Starter
  $39 / Studio $119 / Agency $349), the billable unit being Template Studio
  generation tokens (site assembly is deterministic, included). Higher tiers
  are cheaper per token; **opt-in extra usage** (`POST /v1/billing/overage`)
  keeps generation going past the included tokens, billed to the card on
  file at the tier's overage rate (also cheaper up the tiers, always above
  the included effective rate). Studio generation is quota-gated
  (`402 quota_exhausted`). Billing tab shows a token meter, the extra-usage
  toggle, and a tier grid with upgrade buttons; the marketing site has the
  public tier grid. Numbers are starting points to tune with real
  model-cost data.
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
