# d4-careers-portal

Careers module for the D4 toolkit: a public `/careers` page with job listings and an application form, and a Careers panel in the admin dashboard for managing postings.

Depends on [`d4-cms-core`](https://github.com/deneb4admin/d4-cms-core) (auth, data store, dashboard) on top of [`d4-site-template`](https://github.com/deneb4admin/d4-site-template). Assembly is performed by [`d4-site-builder`](https://github.com/deneb4admin/d4-site-builder).

## What it includes

- `/careers`: lists open positions with type, description, and requirements; each has an inline application form
- Admin panel: create, edit, and delete job postings from `/admin/dashboard`
- `GET /api/careers`: public JSON of current openings
- `POST /api/careers/apply`: stores applications in the `applications` collection and emails them when Resend is configured

## Layout

```
manifest.json    Machine-readable module contract (read this first if you are an agent)
files/           The payload. d4-site-builder copies files/** into the site root.
```

## Data

Jobs live in `data/jobs.json`, applications in `data/applications.json`, both managed through the cms-core data store.
