# Deploying Stardrive

One zero-dependency Node service serves everything: the marketing site (`/`),
the Workbench console (`/workbench/`), and the v1 API. No build step, no
`npm install` — `node services/api/server.mjs` is the whole run command. The
vendored d4 engine (`vendor/d4`) ships with the code, so builds are hermetic.

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
| Template Studio (model) | `STARDRIVE_LLM_KEY` (+ `STARDRIVE_LLM_PROVIDER`, `STARDRIVE_LLM_MODEL`) | Operator's own key; customers never bring one. Studio template generation defaults to `gpt-5.6-sol`. |
| Copywriter (model) | `STARDRIVE_COPY_MODEL` (default `gpt-5.5`) | The site copywriter runs on a lighter model than the Studio to save tokens; same key/provider. Copy never uses em-dashes. |
| Fair-use caps | `STARDRIVE_LLM_MAX_TURNS` (40), `STARDRIVE_LLM_MAX_INPUT_CHARS` (300k) | Defaults are sane; tune per model. |
| **Full QA tier** | `STARDRIVE_QA=full` (+ optional `STARDRIVE_QA_PORT` 4290, `STARDRIVE_QA_TIMEOUT` 300000, `STARDRIVE_PLAYWRIGHT`, `STARDRIVE_AXE`) | Per assembly: npm install → `next build` (the real compile gate) → serve → every route → axe accessibility → 375px overflow → console errors → a screenshot served at `GET /v1/sites/{id}/preview`. Adds ~3–5 min per build; needs npm (+ Playwright for the browser sub-checks, which skip honestly when absent). Default (`structural`) stays fast. |
| Billing checkout | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_STARTER|STUDIO|AGENCY` | Subscription price ids per plan. |
| Billing webhook | `STRIPE_WEBHOOK_SECRET` | Point Stripe at `POST /webhooks/stripe`; flips plans on subscribe/cancel. |
| Email | `RESEND_API_KEY`, `STARDRIVE_EMAIL_FROM`, `STARDRIVE_LEADS_TO` | Signup welcome + access-request notifications. |
| Rate limit | `RATE_LIMIT_PER_MIN` (120) | Per key. |

## State & persistence

Runtime state is file-backed JSON under `STARDRIVE_VAR_DIR` (default `./var`,
mount a volume in prod). The store interface is four verbs (`readJson`,
`writeJson`, `deleteJson`, `listIds`) — deliberately swappable for Turso when
scale calls for it, without touching the API surface.

## Go live (runbook)

The whole product is one container. A single instance with a persistent volume
is a valid launch topology (no external database required to start).

1. **Build & run the image** (`Dockerfile` at the repo root):
   `docker build -t stardrive . && docker run -p 8080:8080 -v stardrive-data:/data --env-file prod.env stardrive`
2. **Set the required secrets** in `prod.env`: `STARDRIVE_SECRET` (encrypts
   stored hosting tokens — REQUIRED), `STARDRIVE_LLM_KEY` (turns the Studio +
   copywriter on). The image already sets `STARDRIVE_ENGINE=real`,
   `STARDRIVE_QA=full`, `STARDRIVE_SECURE_COOKIES=1`, `STARDRIVE_VAR_DIR=/data`.
3. **Domain + TLS**: put stardrive.dev in front of `:8080` behind HTTPS (any
   reverse proxy / platform TLS). The root redirects to `/workbench/`.
4. **Payments** (when ready): add `STRIPE_SECRET_KEY`, `STRIPE_PRICE_STARTER|STUDIO|AGENCY`,
   and `STRIPE_WEBHOOK_SECRET`; point a Stripe webhook at `POST /webhooks/stripe`.
   The checkout + plan-flip code is built and tested; it activates on these keys.
5. **Email** (when ready): add `RESEND_API_KEY`, `STARDRIVE_EMAIL_FROM`,
   `STARDRIVE_LEADS_TO`. Signup welcomes + access-request notifications activate.
6. **Browser QA sub-checks** (optional): add Playwright + chromium to the image
   and set `STARDRIVE_PLAYWRIGHT`/`STARDRIVE_AXE` for the accessibility check and
   the preview screenshot. Core QA (install → build → serve → routes) runs
   without them.

`GET /v1/health` reports `engine`, `qa`, and the configured Studio/copy models;
the image `HEALTHCHECK` uses it.

## Scale-up (post-launch)

- **Turso store**: the store interface is four verbs (`readJson`, `writeJson`,
  `deleteJson`, `listIds`), so a libSQL/Turso adapter is a drop-in when moving
  from one instance to many. Single-instance + volume needs no code change.
- **One-click hosting provisioning**: the deploy actuator pushes the assembled
  site to the customer's **GitHub** today (their connected token). Direct
  Vercel/Turso provisioning per client is the next integration; until then,
  linking the pushed repo to Vercel builds on push.
