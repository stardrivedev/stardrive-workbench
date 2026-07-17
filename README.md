# Stardrive

**The d4 site engine as a product — API-first.** A freelancer or agency signs
up, gets an API key, and drives the engine however fits their shop: call the
Stardrive API from their own pipeline, or use the Workbench (a thin web
dashboard over the same API). Pick a template (the included d4 catalog, or
import your own), map your intake questionnaire onto it once, submit a
client's answers, and the engine assembles a real, standalone Next.js site —
QA'd, themed, and deployed to the licensee's own hosting accounts. The same
deterministic builder that runs Deneb4's studio, productized.

Domain: **stardrive.dev** · Status: **pre-alpha** (field-mapping layer
shipped and production-proven; API service foundation live behind a dry
assembly engine — real engine executor is the next chunk)

## Why API-first (decided 2026-07-16)

Previously planned as installable Electron desktop software; pivoted:

- **Agencies integrate, they don't click.** The buyers with recurring volume
  want the engine inside their own intake → build → deploy pipeline. An API
  key is the product; the dashboard is a convenience on top.
- **A whole cost class disappears**: installer packaging, Windows
  Authenticode certificates, Apple notarization, auto-updates — none of it
  exists in this architecture.
- **Revenue shape**: usage-based recurring (per assembled site / per seat)
  instead of one-time license sales.
- Known trade-off: no offline story, and Stardrive absorbs build compute.
  If offline/on-prem demand materializes, a desktop wrapper can return
  later — the engine stays separable by design.

## What Stardrive is — and is not

Stardrive v1 is **the builder**: template → mapped client facts → assembled
site → QA → deploy. It is deliberately NOT Deneb4's full agency-ops layer
(agents, client portal, pipeline, billing) — those are studio operations,
not the engine. A licensee runs their own business; Stardrive builds their
clients' sites.

## Architecture

```
Licensee's systems ──── API key ────┐
Workbench (thin web dashboard) ─────┤
                                    ▼
                        Stardrive API (services/api)
                          ├─ Mappings    validate / parse intake answers
                          │              └─ packages/field-mapping  ✅ SHIPPED
                          ├─ Templates   d4 catalog + imported third-party
                          │              (validated: manifest schema, theme
                          │               tokens, WCAG contrast)
                          ├─ Sites       assemble → d4-site-builder
                          │              (deterministic; no LLM)
                          ├─ QA          the verify battery (routes, links,
                          │              a11y incl. contrast, mobile overflow)
                          └─ Deploy      licensee's OWN Vercel / Turso /
                                         GitHub credentials
```

The engine repos (d4-site-builder, d4-site-template, d4-cms-core, and the
feature modules) remain their own public repositories — they are the product
content this service orchestrates. This repo is the product.

## Key contracts (what makes third-party templates possible)

- **Manifest contract**: every template/module is a repo with a
  `manifest.json` declaring what it provides (routes, nav, admin panels,
  collections) and requires. See `docs/template-author-contract.md`.
- **Theme-token contract**: ~9 CSS custom properties any compliant template
  consumes; light + dark palettes validated for WCAG contrast before use.
- **Field-mapping contract**: a declarative JSON document mapping YOUR
  questionnaire onto YOUR template's config slots — authored once, by a
  non-engineer. See `packages/field-mapping/README.md`.
- **Admin-panel plugin API**: templates ship their own dashboard editors;
  the generated panel registry wires them in.

## Repository layout

- `docs/` — vision, roadmap, API design, and the template-author contract
- `packages/field-mapping/` — the declarative intake→config engine
  (**shipped**: pure ESM, zero deps, 21 unit tests; extracted from and
  regression-tested against Deneb4's production intake pipeline)
- `services/api/` — the Stardrive API (**foundation live**: keys/scopes/
  rate-limit/metering, mapping + template + site/job endpoints, 24-check
  E2E suite; assembly runs on the dry engine until the real executor is
  wired — see its README)
- `app/workbench/` — the thin web dashboard over the API (not started)

## Provenance

Built on the d4 engine developed for and battle-tested by
[Deneb4 LLC](https://deneb4.com). Stardrive Technology and Deneb4 are the
same ownership; Deneb4 is the studio, Stardrive is the engine as a product.
