# Stardrive API — design (v1)

The product surface. Everything the Workbench dashboard does goes through
this API; a licensee's own pipeline can do the same with the same key. This
document is the M2 build spec — REST, versioned under `/v1`, JSON in/out.

## Principles

- **The API key IS the license.** Key scopes + usage metering replace
  license files, installers, and activation.
- **Deterministic core.** Assembly is d4-site-builder: no LLM, no
  surprises — the same config always yields the same site. Anything
  generative lives OUTSIDE the engine and is never required.
- **Licensee owns the output.** Sites deploy to THEIR Vercel/Turso/GitHub
  (stored per-account as encrypted **connections**, chosen tiers and regions
  are theirs within the supported-provider set); the assembled repo is
  theirs to export at any time. No lock-in by hostage-taking.
- **The engine is never visible.** Customers receive assembled site output
  only: standalone Next.js repos with zero Stardrive runtime dependency.
  No export, deploy, or repo push ever contains engine code, and job
  logs expose step names and QA results, never engine internals. This is
  the hard IP boundary of the product.
- **Client data is transient by default.** Intake answers and assembled
  artifacts live for the job's lifetime + a grace window, then delete.
  Stardrive is infrastructure, not a data warehouse.

## Auth

`Authorization: Bearer sk_live_…` — per-licensee keys, scoped
(`mappings`, `templates`, `sites`, `deploy`), rotatable, with per-key rate
limits and usage counters. 401 unauthenticated, 403 out-of-scope, 429 over
rate/plan.

## Tenancy (implemented)

Every key carries an **account** id; keys minted with `--account` share
one. Imported templates, stored mappings, and sites/jobs are private to
their account — cross-account reads 404, and two accounts can hold
same-named templates without collision. The bundled d4 catalog is the only
shared surface, and imports can never shadow its names.

## Endpoints

### Mappings (the M1 engine as a service — pure, cheap, first to ship)

| | |
|---|---|
| `POST /v1/mappings/validate` | Body: a stardrive-field-mapping/v1 document. → `{ ok, errors[] }` (every problem, not just the first). |
| `POST /v1/intake/parse` | Body: `{ mapping, answers }` (or `mappingId` once stored mappings exist). → `{ config, contact, flags, notes, unmapped, context, mapReport }`. Stateless. |
| `PUT /v1/mappings/{id}` / `GET` / `LIST` | Stored named mappings, versioned, so `parse` and `sites` can reference them by id. |

### Templates

| | |
|---|---|
| `GET /v1/templates` | The bundled d4 catalog + the licensee's imported templates, with manifest summaries. |
| `POST /v1/templates` | Import: a git URL or tarball. Validated before acceptance: manifest schema, route/panel conflicts, theme-token contract, WCAG contrast on declared palettes. → accepted or a full error report. |
| `GET /v1/templates/{id}` | Manifest detail: routes, nav, admin panels, env needs, config slots (what a mapping can target). |

### Sites (assemble → QA → deploy)

| | |
|---|---|
| `POST /v1/sites` | Body: `{ templateId, config }` or `{ templateId, mappingId, answers }` (parse + assemble in one step). Creates an async **job**. → `{ jobId, siteId }`. |
| `GET /v1/jobs/{id}` | `queued → assembling → qa → done | failed`, with per-step logs and the QA report (routes render, links, console errors, axe incl. contrast, 375px overflow). QA-red never advances to deployable. |
| `GET /v1/sites/{id}/export` | The assembled repo as a tarball (or push-to-their-GitHub via deploy). Always available — their site, their code. |
| `POST /v1/sites/{id}/deploy` | Body: licensee credentials (Vercel token, Turso, GitHub) — passed per-call or stored encrypted per-licensee, their choice. → deploy job. |
| `POST /v1/sites/{id}/change` | A config delta: re-assemble applies only the delta, re-QA, ready to redeploy — the d4 change-loop doctrine (QA-rejected changes auto-revert). |

### Asset compartments (implemented)

Named upload slots per site, so customer files land in the right place on
the assembled site without anyone thinking about paths. Standard slots on
every `kind:"site"` template: `logo`, `favicon`, `hero`, `about`,
`gallery`, `team`, `misc` (ids reserved); templates declare EXTRA slots
via manifest `assetSlots` (validated by template-kit). Each slot maps to a
deterministic target (`public/assets/<slot>/…`; favicon → `src/app/`).

| | |
|---|---|
| `GET /v1/sites/{id}/assets` | The site's slots (standard + template-declared) and current contents. |
| `POST /v1/sites/{id}/assets/{slot}` | Upload `{ filename, contentBase64 }` — per-slot type allowlist, count cap, 8 MB max. Returns the resolved target path. |
| `GET /v1/sites/{id}/assets/{slot}/{assetId}` | Serves the file back (account-scoped). |
| `DELETE /v1/sites/{id}/assets/{slot}/{assetId}` | Remove. |
| `POST /v1/sites/{id}/assemble` | Re-assemble with current config + latest assets; the dry engine records the slot→target resolution in the workspace marker, the real engine copies the files. |

### Connections (implemented)

| | |
|---|---|
| `GET /v1/connections` | Masked view: which providers are connected + last4. Tokens are NEVER returned by any route. |
| `PUT /v1/connections/{provider}` | Save the licensee's own `vercel` \| `turso` \| `github` token (+ optional GitHub owner). AES-256-GCM at rest (key from `STARDRIVE_SECRET`, or a generated `var/secret.key`); decrypted server-side at deploy time only. |
| `DELETE /v1/connections/{provider}` | Disconnect. |

### Account

| | |
|---|---|
| `GET /v1/usage` | Metered counters (sites assembled, deploys, parse calls) for the current billing period. |
| `POST /v1/keys/rotate` | Self-service key rotation. |
| Webhooks | `job.completed`, `job.failed`, `usage.threshold` → licensee-registered URLs, signed. |

## Metering / pricing shape (decide with real beta data)

- `intake/parse` + `mappings/validate`: free or near-free (adoption surface,
  costs nothing to run).
- The meter that matters: **sites assembled** (and re-assembled changes at a
  discount), plus a plan floor per month. Deploys included; compute-heavy QA
  batched into the assemble price.

## Implementation notes

- The API service wraps the SAME scripts the Deneb4 studio runs
  (d4-site-builder, the verify battery) in an isolated per-job workspace;
  jobs are containerizable later without API changes.
- `packages/field-mapping` is imported directly (pure ESM, zero deps) — the
  parse endpoints are a thin HTTP shell around `runMapping`/`validateMapping`.
- Stack intent: same house stack (Next.js API routes or a small Node
  service), Turso for keys/usage/jobs metadata, blob storage for transient
  artifacts. Boring on purpose.
