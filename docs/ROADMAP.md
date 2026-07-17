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

## M2 — The Stardrive API (~8–14 sessions)
`services/api` per `docs/api-design.md`:
- API-key auth, versioned REST surface (`/v1`).
- **First live endpoints are pure and cheap**: `POST /v1/mappings/validate`
  and `POST /v1/intake/parse` (the M1 engine as a service).
- Templates: the d4 catalog + import-and-validate for third-party templates
  (manifest schema, theme tokens, contrast validator).
- Sites: assemble (d4-site-builder as a worker job), QA battery, deploy with
  licensee-supplied Vercel/Turso/GitHub tokens; job status + webhooks.
- Usage metering per key (the billing meter).

## M3 — Sellable 1.0 (~6–12 sessions + owner tasks)
- The Workbench: thin web dashboard over the API (template library, mapping
  editor with live validate, client-facts form, build/QA/deploy status).
- Payments/merchant-of-record: Paddle or Lemon Squeezy (they handle sales
  tax — right-sized for a solo operation); subscription + metered usage.
- Key issuance, rotation, scoping; rate limits.
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
