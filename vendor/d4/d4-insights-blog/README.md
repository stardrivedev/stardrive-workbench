# d4-insights-blog

Articles module for the D4 toolkit: a public `/insights` index with per-article pages, and an Articles panel in the admin dashboard where posts are written in markdown with cover image upload.

Depends on [`d4-cms-core`](https://github.com/deneb4admin/d4-cms-core) (auth, data store, markdown renderer, dashboard) on top of [`d4-site-template`](https://github.com/deneb4admin/d4-site-template). Assembly is performed by [`d4-site-builder`](https://github.com/deneb4admin/d4-site-builder).

## What it includes

- `/insights`: article index, newest first, with tags and cover images
- `/insights/[id]`: full article rendered from markdown
- Admin panel: create, edit, and delete articles from `/admin/dashboard`

## Layout

```
manifest.json    Machine-readable module contract (read this first if you are an agent)
files/           The payload. d4-site-builder copies files/** into the site root.
```

## Data

Articles live in `data/articles.json`, managed through the cms-core data store. Bodies are markdown, rendered server-side by `@/lib/cms/markdown`.
