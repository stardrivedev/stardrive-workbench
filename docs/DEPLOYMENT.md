# Deploying Stardrive

One zero-dependency Node service serves the Workbench console (`/workbench/`)
and the v1 API; `/` redirects into the console. The public marketing site is a
separate deployment, built with Stardrive itself, and is not bundled here. No
build step, no `npm install` — `node services/api/server.mjs` is the whole run
command. The vendored d4 engine (`vendor/d4`) ships with the code, so builds
are hermetic.

## Run

```
node services/api/server.mjs            # dev (dry engine, everything dormant)
STARDRIVE_ENGINE=real node services/api/server.mjs   # real assembly + export
```

Docker:

```
docker build -t stardrive .
docker run -p 8080:8080 -v stardrive-data:/data \
  -e STARDRIVE_SECRET=... stardrive
```

## Launch checklist (flip these on when ready)

Everything works dormant; each env var lights up a capability with no code change.

| Capability | Env | Notes |
|---|---|---|
| Real site assembly + export | `STARDRIVE_ENGINE=real` | Ships already; produces real Next.js sites. |
| Encrypt stored hosting tokens | `STARDRIVE_SECRET` | **Required in prod.** A `var/secret.key` is auto-generated in dev; production must set this from a real secret store. |
| Secure session cookies | `STARDRIVE_SECURE_COOKIES=1` | Set behind HTTPS. |
| Links that leave the server | `STARDRIVE_PUBLIC_URL` | **Set this in prod.** Your real public address, scheme included. Used for verification, password-reset and client intake links. Without it they are built from the request's Host header: always `http://` behind a TLS proxy, and set by whoever is calling. |
| Template Studio (model) | `STARDRIVE_LLM_KEY` (+ `STARDRIVE_LLM_PROVIDER`, `STARDRIVE_LLM_MODEL`) | Operator's own key; customers never bring one. Studio template generation defaults to `gpt-5.6-sol`. |
| Copywriter (model) | `STARDRIVE_COPY_MODEL` (default `gpt-5.5`) | The site copywriter runs on a lighter model than the Studio to save tokens; same key/provider. Copy never uses em-dashes. |
| Fair-use caps | `STARDRIVE_LLM_MAX_TURNS` (40), `STARDRIVE_LLM_MAX_INPUT_CHARS` (300k) | Defaults are sane; tune per model. |
| **Full QA tier** | `STARDRIVE_QA=full` (+ optional `STARDRIVE_QA_PORT` 4290, `STARDRIVE_QA_TIMEOUT` 300000, `STARDRIVE_PLAYWRIGHT`, `STARDRIVE_AXE`) | Per assembly: npm install → `next build` (the real compile gate) → serve → every route → axe accessibility → 375px overflow → console errors → a screenshot served at `GET /v1/sites/{id}/preview`. Adds ~3–5 min per build; needs npm (+ Playwright for the browser sub-checks, which skip honestly when absent). Default (`structural`) stays fast. |
| Billing checkout | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_STARTER|STUDIO|AGENCY` | Subscription price ids per plan. |
| Billing webhook | `STRIPE_WEBHOOK_SECRET` | Point Stripe at `POST /webhooks/stripe`; flips plans on subscribe/cancel. |
| Email | `RESEND_API_KEY`, `STARDRIVE_EMAIL_FROM`, `STARDRIVE_LEADS_TO` | Signup welcome + access-request notifications. **Also switches on email verification** (see below). |
| Rate limit | `RATE_LIMIT_PER_MIN` (120) | Per key. |
| Signup ration | `SIGNUP_LIMIT_PER_HOUR` (5) | Accounts one IP may CREATE per hour. Rejected attempts (bad password, duplicate email) are free, so a typo never burns a real person's allowance. |
| Operator telemetry | `STARDRIVE_OPS_TOKEN` | Unlocks `GET /v1/ops`. Not an API-key scope: no licensee should ever read the queue, the disk, or another tenant's error paths. |
| Alert email | `STARDRIVE_ALERT_TO` (falls back to `STARDRIVE_LEADS_TO`) | Where the watchdog writes when something goes wrong. Needs `RESEND_API_KEY` too. |
| Queue alarm | `STARDRIVE_QUEUE_ALERT` (25) | Queued builds that count as a backlog worth an email. |

## Abuse control on the front door

Signup is unauthenticated and every generation spends the operator's model
budget, so two things guard it:

- **A per-address ration** on accounts created (`SIGNUP_LIMIT_PER_HOUR`).
- **Email verification before any model spend.** With `RESEND_API_KEY` set, a
  new account starts unverified: it can log in, connect hosting, import
  templates, and set up clients, but template generation, copywriting, and
  batch submission all answer `403 email_unverified` until the address is
  confirmed. The link lands on `GET /auth/verify` and redirects into the
  Console; `POST /auth/resend-verification` sends a fresh one.

Like every other capability here it is **dormant when it cannot work**: with
no email provider configured there is no way to send a link, so accounts are
created already verified rather than being stranded behind one. That means
**turning on email is what turns on verification** — worth knowing before you
add `RESEND_API_KEY` to an existing deployment, since accounts created after
that point will need to confirm. Accounts created before verification existed
are treated as verified and are never retro-locked.

## State & persistence

Runtime state is file-backed JSON under `STARDRIVE_VAR_DIR` (default `./var`,
mount a volume in prod). The store interface is four verbs (`readJson`,
`writeJson`, `deleteJson`, `listIds`) — deliberately swappable for Turso when
scale calls for it, without touching the API surface.

### Backups

The var directory **is** the business: every account, API key, template,
site, and encrypted hosting token. Losing the volume loses every licensee's
work at once.

```
node services/api/scripts/backup.mjs create  /backups --var-dir /data
node services/api/scripts/backup.mjs verify  /backups/stardrive-<stamp>.tar.gz
node services/api/scripts/backup.mjs restore /backups/stardrive-<stamp>.tar.gz /data
```

- Snapshots **exclude `workspaces/`** (build output, regenerable by
  rebuilding, and the overwhelming majority of the bytes). What is kept is
  the irreplaceable part, and it is small.
- Each snapshot gets a `.sha256` sidecar; `verify` and `restore` both check
  it and refuse a corrupt archive rather than restoring damage.
- `restore` refuses a non-empty target unless you pass `--force`, so it
  cannot quietly overwrite a live deployment.

**Back up `STARDRIVE_SECRET` separately, in a password manager, not beside
the data.** Hosting tokens are encrypted with it: restore without the same
secret and you get accounts and sites but dead credentials. A drill for
exactly this lives in `services/api/test/backup-restore.mjs`, which destroys
a deployment and restores it with the right secret and the wrong one.

Run a restore drill before you take money, and again whenever the store
layout changes. A backup nobody has restored is a hope, not a backup.

## Go live (runbook)

The whole product is one container. A single instance with a persistent volume
is a valid launch topology (no external database required to start).

1. **Make `prod.env`**: `node services/api/scripts/make-prod-env.mjs`. It copies
   `docs/prod.env.example`, generates the two values nobody issues you
   (`STARDRIVE_SECRET` and `STARDRIVE_OPS_TOKEN`), writes the file `0600`, and
   refuses to overwrite an existing one. It does **not** print the secrets;
   pass `--print-secret` when you are ready to copy `STARDRIVE_SECRET` into a
   password manager, which you should do the day it exists. Keep it there,
   apart from any backup of the data: restore without it and every stored
   hosting token is undecryptable.

   `prod.env` is gitignored via `*.env`. `docs/prod.env.example` is not, so no
   real value ever goes in it.
2. **Fill in what only you can fetch**: `STARDRIVE_LLM_KEY` (platform.openai.com,
   and the account needs credit or every generation is a 502) and
   `STARDRIVE_PUBLIC_URL` (your real public address, scheme included). The image
   already sets `STARDRIVE_ENGINE=real`, `STARDRIVE_QA=full`,
   `STARDRIVE_SECURE_COOKIES=1`, `STARDRIVE_VAR_DIR=/data`.
3. **Build & run the image** (`Dockerfile` at the repo root):
   `docker build -t stardrive . && docker run -p 8080:8080 -v stardrive-data:/data --env-file prod.env stardrive`
4. **Domain + TLS**: put stardrive.dev in front of `:8080` behind HTTPS (any
   reverse proxy / platform TLS). The root redirects to `/workbench/`. Make
   `STARDRIVE_PUBLIC_URL` match it exactly; the service warns on boot if it is
   unset in production.
5. **Email — do this BEFORE you open signup, not after.** Add `RESEND_API_KEY`,
   `STARDRIVE_EMAIL_FROM` and `STARDRIVE_LEADS_TO`. The sending address's domain
   must be verified in Resend (Domains, add it, set the DNS records) or every
   send fails. Setting this is also what switches email verification on, so
   adding it later splits your accounts into two cohorts: everyone created
   before it is verified forever, everyone after must confirm.

   This is **not** the same slot as a client site's Resend key. Those are set
   per site in the Workbench under Site settings, and belong to whoever owns
   that client's hosting.
6. **Monitoring** (before the first paying customer): `STARDRIVE_OPS_TOKEN` is
   already generated in `prod.env`; add `STARDRIVE_ALERT_TO` alongside
   `RESEND_API_KEY`. Then `POST /v1/ops/test-alert` and confirm the mail
   arrives. That one call exercises provider key, sender identity and recipient
   together, which is the whole path, before a real failure has to.
7. **Payments** (when ready): add `STRIPE_SECRET_KEY`, `STRIPE_PRICE_STARTER|STUDIO|AGENCY`,
   and `STRIPE_WEBHOOK_SECRET`; point a Stripe webhook at `POST /webhooks/stripe`.
   The checkout + plan-flip code is built and tested; it activates on these keys.
8. **Browser QA sub-checks** (optional): add Playwright + chromium to the image
   and set `STARDRIVE_PLAYWRIGHT`/`STARDRIVE_AXE` for the accessibility check and
   the preview screenshot. Core QA (install → build → serve → routes) runs
   without them.

## Monitoring

The image `HEALTHCHECK` notices a dead process. It notices nothing else, and
the failures that actually cost a licensee their afternoon are quieter: a full
disk so every build dies in `npm install`, a wedged queue so a batch of twenty
sits at "queued" forever, a container crash-looping, 500s pouring out of one
route.

**`GET /v1/health`** stays public and deliberately coarse: `engine`, `qa`, the
configured Studio/copy models, a `degraded` flag, and `builds` as
`{ concurrency, active, queued, accountsWaiting }`. `ok: true` means only "the
process is answering", and nothing more: letting a full disk flip it false
would restart-loop the container over a condition a restart cannot fix.
`degraded: true` is the honest signal, and `/v1/ops` says why.

**`GET /v1/ops`** (`Authorization: Bearer $STARDRIVE_OPS_TOKEN`) is the whole
picture: uptime, request counters split into client mistakes and our own 5xx,
free disk, the oldest running build, active alerts, and the last 50 errors with
their route and code. Query strings are dropped from those records on purpose,
since that is where verification tokens and checkout session ids live. Without
the env var the route answers `501 ops_unconfigured` and says how to switch it
on, rather than sitting open.

- `POST /v1/ops/check` runs the watchdog now instead of waiting out the minute.
- `POST /v1/ops/test-alert` proves the whole alert path (provider key, sender
  identity, recipient) before a real failure has to.

**What gets emailed.** A watchdog samples once a minute and mails
`STARDRIVE_ALERT_TO` when one of these holds:

| Alert | Fires when | Waits first |
|---|---|---|
| `disk_low` | Builds are being refused for lack of space | No: waiting will not un-fill it |
| `queue_stalled` | Work is queued and nothing is running | 5 min |
| `queue_deep` | `STARDRIVE_QUEUE_ALERT` builds waiting | 5 min |
| `build_stuck` | The oldest build has run over 45 min | No: the age is the proof |
| `errors_spiking` | 10+ server errors in 15 min | No |
| `restart_loop` | 5 starts in an hour replacing dead processes | No |
| `fatal` | An uncaught exception or unhandled rejection | No |

Each one is sent at most once every six hours, and its recovery is reported
when the condition clears. The debounce is **persisted**, because the failure
that most needs an email is a crash loop, and an in-memory debounce resets on
every crash. A restart only counts toward `restart_loop` if the process it
replaced both died and did not shut down cleanly, so deploys and rolling
restarts stay quiet.

Like everything else here it is **dormant when it cannot work**: with no email
provider or no recipient, every condition is still tracked and still readable
at `/v1/ops`, it just cannot be pushed anywhere, and `alerting.reason` says
which of the two is missing.

**Still worth adding from outside:** an external uptime check hitting
`/v1/health` from another network. Nothing inside the container can tell you
the container is unreachable.

## What a CLIENT site needs (and who supplies it)

Not to be confused with the env table above, which configures **Stardrive
itself**. This is about the sites your licensees build for their customers.

Every variable a built site needs falls into exactly one of three buckets, and
`GET /v1/sites/:id/env` reports them that way:

| Bucket | Examples | Who fills it |
|---|---|---|
| **Managed** | `ADMIN_PASSWORD`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `NEXT_PUBLIC_SITE_URL` | Stardrive, automatically, on every publish |
| **Supplied** | `RESEND_API_KEY`, `CONTACT_TO_EMAIL`, and image storage (below) | The licensee, once per site, in the Workbench |
| **Optional** | anything a module declares and nobody set | Nobody. The feature stays dormant and says so. |

**Image storage is one requirement with two answers**, because the right one
depends on the host: `BLOB_READ_WRITE_TOKEN` (Vercel Blob), or `S3_BUCKET` +
`S3_ACCESS_KEY_ID` + `S3_SECRET_ACCESS_KEY` for any S3-compatible bucket
(Cloudflare R2, Backblaze B2, Wasabi, MinIO, AWS), optionally with
`S3_ENDPOINT`, `S3_REGION` and `S3_PUBLIC_BASE_URL`. Either one satisfies it,
and the Workbench offers whichever suits the hosting that licensee has
connected. With neither set a production site **refuses uploads and says why**,
rather than writing them to a disk the next deploy erases.

Publishing a site whose admin has no database behind it is refused for the
same reason (`422 no_durable_store`): the client would change their opening
hours, watch it save, and lose it on the next deploy. `force: true` gets past
it for a throwaway demo.

`ADMIN_PASSWORD` is generated per site and is **stable**: rotating it on every
publish would silently lock out a client who wrote it down. `POST
/v1/sites/:id/env/rotate-admin` issues a new one when a site changes hands.

Supplied values are AES-256-GCM at rest under `STARDRIVE_SECRET`, never
returned through any listing, and reused on every future publish of that site.
The settings route accepts **only** the supplied names, so a caller cannot
overwrite the database URL or the admin password through it.

**No Stripe key is needed by a client site.** `d4-payments` uses Stripe Payment
Links, created in the site owner's own dashboard, so no API key, webhook or
card data is ever in scope.

### Hosts Stardrive writes to directly

Publishing from the Workbench pushes the whole environment for you:

- **Vercel** (`POST /v1/sites/:id/deploy/vercel`)
- **Netlify** (`POST /v1/sites/:id/deploy/netlify`)

### Everywhere else

`GET /v1/sites/:id/env/file` returns a ready-filled `.env`, and every assembled
site ships a `Dockerfile` and a `DEPLOY.md` naming real hosts with real steps.
A git push to any repository host means **Vercel, Netlify, Cloudflare Pages,
Render, Railway, Amplify and DigitalOcean** all build it with no code change.

**There is no Cloudflare Pages direct-upload adapter, deliberately.** The CMS
depends on `@libsql/client`, `otplib` and `qrcode`, which are Node libraries,
so a direct upload would produce a site whose admin area is broken. Cloudflare
is supported through the git path instead.

**The one constraint worth knowing before promising anything:** a site with an
admin area or any form is an application, not a folder of files, so it needs a
host that runs Node. That rules out static-only hosting: a plain S3 or R2
bucket, GitHub Pages, basic shared hosting. (An S3 bucket is still exactly
right for the site's *uploaded images* — storing files and running an
application are different jobs.) `DEPLOY.md` says so in the client's copy too.

## Handing a site to the client

`GET /v1/sites/:id/handoff` renders a printable, self-contained page for the
person who paid for the site: where it lives, how to sign in, what they can
change themselves, and who to contact. It shows the admin password **in full**,
because a handoff that says "ask your developer for the password" is not a
handoff.

What it lists is derived from the modules actually installed, so it never
promises a Menu tab to a site with no menu. It also states the honest gaps: with
no Resend key saved, it tells the client their website messages are saved in the
dashboard Inbox and nothing is emailed, so check it.

## Scale-up (post-launch)

- **Turso store**: the store interface is four verbs (`readJson`, `writeJson`,
  `deleteJson`, `listIds`), so a libSQL/Turso adapter is a drop-in when moving
  from one instance to many. Single-instance + volume needs no code change.
- **One-click hosting provisioning**: the deploy actuator pushes the assembled
  site to the customer's **GitHub** today (their connected token). Direct
  Vercel/Turso provisioning per client is the next integration; until then,
  linking the pushed repo to Vercel builds on push.

## Build throughput

Builds run on a bounded worker pool, `STARDRIVE_BUILD_CONCURRENCY` (default 2).
A full-QA build is `npm install` plus `next build`, so each one is CPU and
memory hungry; raise this only with headroom to match.

Work is taken **round-robin per account**, not first-in-first-out. An agency
submitting a batch of twenty therefore cannot put every other licensee behind
an hour of their builds: a single build queued afterwards runs next, not last.

Two jobs for the same site never overlap, because they share one workspace
directory. `GET /v1/health` reports `builds: { concurrency, active, queued,
accountsWaiting }`, so a backed-up queue is visible from outside instead of
only surfacing as customers wondering why nothing finished. Free disk and the
oldest running build are on `/v1/ops` instead: they are the operator's
business, not the internet's.
