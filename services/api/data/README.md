# Bundled data — provenance

- `catalog/*.json` — verbatim copies of `manifest.json` from the six
  first-party d4 engine repos (d4-site-template 1.2.0, d4-cms-core,
  d4-catalog, d4-careers-portal, d4-insights-blog, d4-gallery-editor),
  taken 2026-07-16. Refresh by re-copying from the upstream repos when they
  version-bump; `loadCatalog()` self-validates the bundle at boot and
  refuses to start on a bad manifest.
- `schema/manifest.schema.json` — the canonical manifest contract, vendored
  from d4-site-builder (`schema/manifest.schema.json`). The API's validator
  (`lib/templates.mjs`) implements this schema with one documented product
  relaxation: template names for licensees may be any lowercase slug — the
  `d4-` prefix rule applies to the first-party catalog only.
