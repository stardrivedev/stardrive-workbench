# Stardrive Workbench

**The d4 site engine as installable desktop software.** A freelancer or agency
buys Stardrive, installs it, and gets a workbench: pick a template (the
included d4 catalog, or import your own), fill in a client's facts, and the
engine assembles a real, standalone Next.js site — QA'd, themed, and
deployable to the licensee's own hosting accounts. The same deterministic
builder that runs Deneb4's studio, productized.

Domain: **stardrive.dev** · Status: **pre-alpha scaffold** (vision + contracts
committed; application code not started)

## What Stardrive is — and is not

Stardrive v1 is **the builder**: template → client facts → assembled site →
QA → deploy. It is deliberately NOT Deneb4's full agency-ops layer (agents,
client portal, pipeline, billing) — those are studio operations, not the
engine. A licensee runs their own business; Stardrive builds their clients'
sites.

## Architecture (planned)

```
Electron shell (the workbench UI)
  ├─ Template library
  │    ├─ the d4 catalog (site template + cms-core + 4 feature modules)
  │    └─ imported third-party templates (validated: manifest schema,
  │       theme-token contract, WCAG contrast validator)
  ├─ Client-facts form  ← driven by the declarative field-mapping layer
  ├─ Assemble  → d4-site-builder (deterministic; no LLM, no network)
  ├─ Preview   → local next dev/start
  ├─ QA        → the verify battery (routes, links, a11y incl. contrast,
  │              mobile overflow)
  └─ Deploy    → licensee's OWN Vercel / Turso / GitHub credentials
```

The engine repos (d4-site-builder, d4-site-template, d4-cms-core, and the
feature modules) remain their own public repositories — they are the product
content this app orchestrates. This repo is the app.

## Key contracts (what makes third-party templates possible)

- **Manifest contract**: every template/module is a repo with a
  `manifest.json` declaring what it provides (routes, nav, admin panels,
  collections) and requires. See `docs/template-author-contract.md`.
- **Theme-token contract**: ~9 CSS custom properties any compliant template
  consumes; light + dark palettes validated for WCAG contrast before use.
- **Admin-panel plugin API**: templates ship their own dashboard editors;
  the generated panel registry wires them in.

## Repository plan

- `docs/` — vision, roadmap, and the template-author contract (start here)
- `app/` — the Electron workbench (not started)
- `packages/field-mapping/` — the declarative intake→config mapping layer
  (not started; the one genuinely new engineering piece)

## Provenance

Built on the d4 engine developed for and battle-tested by
[Deneb4 LLC](https://deneb4.com). Stardrive Technology and Deneb4 are the
same ownership; Deneb4 is the studio, Stardrive is the engine as a product.
