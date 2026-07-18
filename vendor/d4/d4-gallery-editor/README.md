# d4-gallery-editor

Gallery module for the D4 toolkit: named image galleries managed through the admin dashboard, a reusable `<Gallery slug="...">` server component any page can embed, and a public `/gallery` page that shows the `main` gallery.

Standalone feature module. Depends on [`d4-cms-core`](https://github.com/deneb4admin/d4-cms-core) (auth, data store, image upload, dashboard) on top of [`d4-site-template`](https://github.com/deneb4admin/d4-site-template). It does not require or depend on `d4-catalog`. Assembly is performed by [`d4-site-builder`](https://github.com/deneb4admin/d4-site-builder).

## What it includes

- Admin panel: create galleries by slug, upload images, reorder them, edit alt text, remove images
- `<Gallery slug="main" />`: server component rendering a responsive image grid, embeddable on any page
- `/gallery`: public page rendering the `main` gallery

## Layout

```
manifest.json    Machine-readable module contract (read this first if you are an agent)
files/           The payload. d4-site-builder copies files/** into the site root.
```

## Data

All galleries live in `data/galleries.json` keyed by slug, managed through the cms-core data store. Images upload through the cms-core upload endpoint.
