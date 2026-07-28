# d4-menu

Food and drink menus, managed from `/admin`.

- **Public page**: `/menu`, every menu, each split into courses.
- **Embeddable**: `<Menu only="lunch" />` from `@/modules/menu/Menu`.
  Renders nothing when no menu exists.
- **Admin panel**: a nested editor. Menus contain courses, courses contain
  dishes; everything reorders with up and down controls. Changes are held
  locally and written on **Save changes**, with an "Unsaved changes" marker,
  because a nested form that saves on every keystroke fights the person typing.

## Why this is not d4-catalog

A catalog lists products with spec tables. A menu is courses in a deliberate
order, prices that are often not numbers ("9 / 14" for two glass sizes), and
dietary information that has to be exactly right.

## Dietary markers

`DIET_MARKERS` is a **closed list** (vegetarian, vegan, gluten free, dairy
free, contains nuts, spicy), not free text. These are the words a guest with an
allergy scans for, and "GF", "gluten-free" and "no gluten" scattered across one
menu is how somebody gets hurt. They render as **words**, never as initials,
because a key is always somewhere the reader is not.

Dishes can be marked **off today** rather than deleted, and they stay visible,
greyed, so regulars can see the dish exists. Unavailable dishes are excluded
from the structured data.

Prices stay display text in `Menu` structured data rather than being forced
into a numeric offer that would misstate a two-size price.

Requires `d4-cms-core` for the admin shell and the data store.

## Collection

`menus`: `Menu[]` (see `src/modules/menu/types.ts`).
