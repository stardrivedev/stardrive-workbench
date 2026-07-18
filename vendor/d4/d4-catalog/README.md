# d4-catalog

Catalog module for the D4 toolkit: a public `/catalog` page with category filtering and product cards (image, description, specification table, optional part number and external link), plus a Catalog panel in the admin dashboard for managing categories and products.

Depends on [`d4-cms-core`](https://github.com/deneb4admin/d4-cms-core) (auth, data store, image upload, dashboard) on top of [`d4-site-template`](https://github.com/deneb4admin/d4-site-template). Assembly is performed by [`d4-site-builder`](https://github.com/deneb4admin/d4-site-builder).

## What it includes

- `/catalog`: filterable product grid grouped by category
- Admin panel: manage categories (label, description) and products (title, category, description, image, specs, part number, link)

## Layout

```
manifest.json    Machine-readable module contract (read this first if you are an agent)
files/           The payload. d4-site-builder copies files/** into the site root.
```

## Data

Products live in `data/products.json` and categories in `data/catalog-categories.json`, both managed through the cms-core data store. Product images upload through the cms-core upload endpoint.
