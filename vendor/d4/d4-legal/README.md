# d4-legal

Privacy policy, terms, and a cookie notice, edited from `/admin`.

- **Public pages**: `/legal` (index) and `/legal/<slug>`.
- **Admin panel**: title, markdown body, and the review gate.

## The review gate is the point of this module

Every page ships as an **unreviewed draft** and returns **404** to visitors
until the owner ticks *Reviewed and ready to publish*. Not hidden behind a
link, not soft-launched: not found. A draft reachable by guessing the URL is a
published draft.

This is deliberate. A generated privacy policy that goes live unread makes
promises to visitors that nobody has checked, and a terms page with a liability
clause copied from another jurisdiction is worse than no terms at all. Stardrive
can give the owner a structure to work from. It cannot give legal advice, and
this module is built so it cannot accidentally appear to.

The drafts are written to make that unmistakable: a banner at the top of each,
`[square brackets]` everywhere a real fact is needed, and prompts naming the
sections that specifically need professional input.

Approving a page stamps the date shown to visitors, so "last updated" means
"last checked by a person", not "last typo fixed".

Markdown is rendered through the cms-core renderer, which escapes HTML first,
so pasted content cannot inject markup.

Requires `d4-cms-core` for the admin shell, the data store and the markdown
renderer.

## Collection

`legal-pages`: `LegalPage[]` (see `src/modules/legal/types.ts`).
