# @stardrive/api

The Stardrive API, v1 — the product surface described in
[docs/api-design.md](../../docs/api-design.md) — **plus the Workbench**, the
web console it serves at `/` (see `app/workbench/`). Zero runtime
dependencies: `node:http` is the whole stack, state is file-backed JSON
under `var/` (interface-compatible with a later Turso swap), and the
field-mapping engine is imported directly from `packages/field-mapping`.

## Run (and see it)

```
node scripts/make-key.mjs --name "me"
node server.mjs [--port 4650]
```

Then open **http://localhost:4650**:

- **/** — the public marketing site (`app/site/`): what Stardrive is, how it
  works, pricing shape, FAQ, and a request-access form whose leads land in
  `var/leads/` (public endpoint, per-IP throttled).
- **/workbench/** — the customer console (`app/workbench/`): overview, your
  private template library with folder upload, the Template Studio (BYO-key
  chat against the authoring rulebook), **Sites** (assemble, watch jobs,
  read QA reports), **Connections** (your own Vercel/Turso/GitHub tokens —
  encrypted at rest, masked on read, used only at deploy time), the full
  API reference with copy-ready curls, keys & usage, and the rulebook.
  Paste the minted key in the top-right box.

```
node test/e2e.mjs        # the full end-to-end suite (spawns its own servers)
```

## Accounts (multi-tenancy)

Every key belongs to an **account**. Imported templates, stored mappings,
and sites/jobs are private to the account that created them — the bundled
d4 catalog is the only shared surface. `make-key.mjs --account <id>` mints
additional keys on an existing account (CI key beside a dashboard key);
without it, each new key gets its own fresh account.

Environment: `PORT`, `STARDRIVE_VAR_DIR` (runtime state; default `./var`,
never committed), `STARDRIVE_ENGINE` (`dry` default | `real` pending),
`RATE_LIMIT_PER_MIN` (per key, default 120).

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
  kept), all against the **dry engine**: a workspace marker + a QA report
  recorded as `skipped`, never as passed.

## Honest 501s (pending, by design)

`POST /v1/templates` (import), `POST /v1/sites/{id}/deploy`, and
`GET /v1/sites/{id}/export` return `501 not_implemented` with an
explanation. They land together with the **real engine executor**: invoking
d4-site-builder + the verify battery in an isolated per-job workspace. That
is the next M2 chunk — it changes `lib/jobs.mjs`, not the API surface.

## Not yet here (M2 remainder)

Real engine executor (above) · webhooks (`job.completed` etc.) · Turso-backed
store for keys/usage/jobs · deployment packaging (container) · CORS story for
the browser Workbench (server-to-server only today).
