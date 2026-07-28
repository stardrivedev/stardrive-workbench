# d4-team

Staff profiles, managed from `/admin`.

- **Public page**: `/team`.
- **Embeddable**: `<Team limit={4} title="Meet the team" />` from
  `@/modules/team/Team`. Renders nothing when nobody has been added.
- **Admin panel**: name, job title, biography, uploaded headshot, optional
  email, phone and profile links. People are reordered with up and down
  controls, because seniority is the usual intent and only the owner knows it.
- Members with no photo render their initials rather than a broken image.

Requires `d4-cms-core` for the admin shell, the data store and image uploads.

## Collection

`team`: `TeamMember[]` (see `src/modules/team/types.ts`). Array order is display order.
