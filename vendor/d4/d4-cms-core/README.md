# d4-cms-core

The admin shell for the D4 toolkit. Provides authenticated content management at `/admin` for assembled client sites. Content modules (`d4-careers-portal`, `d4-insights-blog`, `d4-catalog`, `d4-gallery-editor`) depend on this module: they import its data store and components, and register their editor panels into the dashboard.

Requires [`d4-site-template`](https://github.com/deneb4admin/d4-site-template) as the base. Assembly is performed by [`d4-site-builder`](https://github.com/deneb4admin/d4-site-builder).

## What it includes

- `/admin` login: password (SHA-256 session token, httpOnly cookie), plus TOTP two-factor when `TOTP_SECRET` is set
- `/admin/dashboard`: renders every panel registered in `src/config/admin-panels.generated.tsx`
- `/admin/setup-2fa`: QR code for enrolling an authenticator app
- `src/lib/cms/data-store.ts`: generic JSON-file collections under `data/` at the project root
- `src/lib/cms/markdown.ts`: small markdown-to-HTML renderer used by content modules
- `POST /api/admin/upload`: authenticated image upload to `public/uploads/`
- `ImageDropzone`: drag-and-drop upload component for editor panels

## Layout

```
manifest.json    Machine-readable module contract (read this first if you are an agent)
files/           The payload. d4-site-builder copies files/** into the site root.
```

## Env vars

| Name | Required | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | yes | Login password. Rotate before client handoff. |
| `TOTP_SECRET` | no | Base32 secret enabling two-factor login. |

Generate a TOTP secret with: `node -e "const c='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';console.log([...Array(32)].map(()=>c[Math.floor(Math.random()*32)]).join(''))"`

## Storage model

Content lives in JSON files under `data/` (gitignored, created on first write). Uploaded images live under `public/uploads/`. Both require a writable filesystem on the host. Swapping in a database or object storage later means replacing `src/lib/cms/data-store.ts` and the upload route while keeping their signatures.
