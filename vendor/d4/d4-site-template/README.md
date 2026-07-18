# d4-site-template

The base site shell for the D4 toolkit. Every assembled client site starts from this template; feature modules (`d4-cms-core`, `d4-careers-portal`, `d4-insights-blog`, `d4-catalog`, `d4-gallery-editor`) copy their files in on top of it. Assembly is performed by [`d4-site-builder`](https://github.com/deneb4admin/d4-site-builder).

## What it includes

- Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS 3.4
- Header and footer that render base nav plus module-registered nav entries
- Home, About, and Contact pages driven by `src/config/site.ts`
- Contact form: emails via Resend when `RESEND_API_KEY` is set, otherwise stores submissions in `data/messages.json`
- Theme via CSS variables in `src/app/theme.css`, referenced by Tailwind color tokens

## Layout

```
manifest.json    Machine-readable module contract (read this first if you are an agent)
files/           The payload. d4-site-builder copies files/** into the new site root.
```

## The slot system

Two generated files are the integration points every module plugs into. The builder rewrites them during assembly; they ship with safe empty defaults so the template also builds standalone.

- `src/config/nav.generated.ts` exports `moduleNav: NavItem[]`, appended to the base nav in the header.
- `src/config/admin-panels.generated.tsx` exports the admin dashboard panel registry (used once `d4-cms-core` is installed).

## Standalone use

The `files/` payload is itself a runnable site:

```
cd files
npm install
cp .env.example .env.local   # optional, only needed for email delivery
npm run dev
```

## Env vars

| Name | Required | Purpose |
|---|---|---|
| `RESEND_API_KEY` | no | Contact form email delivery via Resend |
| `CONTACT_TO_EMAIL` | no | Destination inbox when Resend is configured |
