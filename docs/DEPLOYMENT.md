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
| Template Studio (model) | `STARDRIVE_LLM_KEY` (+ `STARDRIVE_LLM_PROVIDER`, `STARDRIVE_LLM_MODEL`) | Operator's own key; customers never bring one. |
| Fair-use caps | `STARDRIVE_LLM_MAX_TURNS` (40), `STARDRIVE_LLM_MAX_INPUT_CHARS` (300k) | Defaults are sane; tune per model. |
| Billing checkout | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_STARTER|STUDIO|AGENCY` | Subscription price ids per plan. |
| Billing webhook | `STRIPE_WEBHOOK_SECRET` | Point Stripe at `POST /webhooks/stripe`; flips plans on subscribe/cancel. |
| Email | `RESEND_API_KEY`, `STARDRIVE_EMAIL_FROM`, `STARDRIVE_LEADS_TO` | Signup welcome + access-request notifications. |
| Rate limit | `RATE_LIMIT_PER_MIN` (120) | Per key. |

## State & persistence

Runtime state is file-backed JSON under `STARDRIVE_VAR_DIR` (default `./var`,
mount a volume in prod). The store interface is four verbs (`readJson`,
`writeJson`, `deleteJson`, `listIds`) — deliberately swappable for Turso when
scale calls for it, without touching the API surface.

## Still to wire before GA

- Deploy actuator today pushes the assembled site to the customer's **GitHub**
  (their connected token). One-click **Vercel/Turso** provisioning is the next
  integration; until then, linking the pushed repo to Vercel builds on push.
- Turso-backed store swap · container orchestration/HA · full browser-QA tier
  (headless build + axe/Playwright behind an opt-in flag).
