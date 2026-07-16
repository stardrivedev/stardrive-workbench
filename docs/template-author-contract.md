# Building a Stardrive-compatible template

What a template author must provide for the Stardrive engine to assemble,
theme, QA, and deploy sites from their design. Three contracts, all small.
(This is the productized form of the d4 engine's internal contracts; the
canonical machine-readable schema lives in the d4-site-builder repo at
`schema/manifest.schema.json`.)

## 1. The manifest contract

Every template or feature module is a git repository with a `manifest.json`
at its root:

```json
{
  "name": "your-template-name",
  "version": "1.0.0",
  "kind": "site",              // "site" (a base template) | "core" | "feature"
  "description": "One paragraph for the engine and its operator.",
  "clientFacingSummary": "One sentence a client proposal can quote.",
  "requires": {},              // e.g. {"d4-cms-core": ">=1.0.0"}
  "provides": {
    "routes": ["/", "/about"], // no two selected modules may claim the same route
    "nav": [{ "label": "About", "href": "/about" }],
    "adminPanels": [],         // dashboard editors this module contributes
    "collections": []          // data collections it reads/writes
  },
  "env": [],                   // env vars it needs, each {name, required, description}
  "copy": [{ "from": "files", "to": "." }]
}
```

The engine reads manifests, resolves `requires`, checks route/panel
conflicts, copies each `files/` payload in order, merges npm dependencies,
and generates the nav + admin-panel registries. It has no knowledge of what
your template *is* — only what it declares.

## 2. The theme-token contract

Consume these CSS custom properties instead of hardcoding colors, and your
template themes itself for every client (space-separated RGB channels, read
through Tailwind as `rgb(var(--token) / <alpha>)`):

| Token | Role |
|---|---|
| `--accent` | Brand accent (links, highlights; a light readable tint in dark mode) |
| `--accent-strong` | Stronger accent (hover states) |
| `--accent-contrast` | Text ON accent fills (white in light, near-black ink in dark) |
| `--bg-base` | Page background |
| `--bg-surface` | Cards, nav, raised surfaces |
| `--text-heading` | Headings |
| `--text-body` | Body text |
| `--text-muted` | Secondary text |

Rules: never alpha-dilute a text token below full strength (it breaks the
4.5:1 WCAG floor the QA battery enforces); ship a `.dark` block only with a
palette that passes the engine's contrast validator; the engine writes
`theme.css` per client — your template just consumes the tokens.

## 3. The admin-panel plugin API

If your template includes client-editable content, each editor is a React
client component (default export) declared in the manifest:

```json
"adminPanels": [{ "id": "menu", "label": "Menu", "importPath": "@/modules/menu/admin/MenuEditor" }]
```

The engine writes the generated panel registry; the dashboard shell (login,
2FA, data store, uploads) is provided by the core module — your editor reads
and writes its declared collections through the shell's data-store API.

## What the QA battery will hold you to

Every assembled site must pass, per client, before it ships: all declared
routes render (correct title, exactly one h1), no broken internal links, no
browser console errors, axe accessibility with zero critical/serious
violations (including real color contrast), and no horizontal overflow at
375px. Design within those constraints and assembly is boring — which is the
point.
