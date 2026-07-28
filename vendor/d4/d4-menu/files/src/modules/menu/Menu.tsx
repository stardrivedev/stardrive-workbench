import { getMenus } from "./data";
import { DIET_MARKERS } from "./types";
import type { Dish, Menu as MenuType } from "./types";

/** Markers render as words, not initials. "V" means nothing to a guest who
 *  has not read the key, and the key is always somewhere else. */
function Markers({ dish }: { dish: Dish }) {
  const marks = (dish.markers ?? []).filter((m) => m in DIET_MARKERS);
  if (!marks.length && !dish.allergenNote) return null;
  return (
    <p className="mt-1 text-xs text-muted">
      {marks.map((m) => DIET_MARKERS[m]).join(" · ")}
      {marks.length && dish.allergenNote ? " · " : ""}
      {dish.allergenNote}
    </p>
  );
}

function DishRow({ dish }: { dish: Dish }) {
  return (
    <li className={`flex items-baseline justify-between gap-4 border-b border-heading/10 py-3 last:border-0 ${dish.unavailable ? "opacity-50" : ""}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {dish.name}
          {dish.unavailable ? <span className="ml-2 text-xs font-normal text-muted">(off today)</span> : null}
        </p>
        {dish.description ? <p className="mt-0.5 text-sm text-body">{dish.description}</p> : null}
        <Markers dish={dish} />
      </div>
      {dish.price ? <p className="shrink-0 text-sm tabular-nums">{dish.price}</p> : null}
    </li>
  );
}

export function MenuBlock({ menu }: { menu: MenuType }) {
  return (
    <article>
      <header className="border-b border-heading/10 pb-4">
        <h2 className="text-2xl font-semibold tracking-tight">{menu.name}</h2>
        {menu.servedWhen ? <p className="mt-1 text-sm font-medium text-accent">{menu.servedWhen}</p> : null}
        {menu.description ? <p className="mt-2 text-sm text-muted">{menu.description}</p> : null}
      </header>

      <div className="mt-8 space-y-10">
        {menu.courses.map((course) => (
          <section key={course.id}>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-accent">{course.name}</h3>
            {course.description ? <p className="mt-1 text-sm text-muted">{course.description}</p> : null}
            <ul className="mt-3">
              {course.dishes.map((dish) => (
                <DishRow key={dish.id} dish={dish} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}

/**
 * Embeddable menu block, for a home page:
 *   <Menu only="lunch" />
 * Renders nothing when no menu has been written yet.
 */
export default async function Menu({ only, limit = 1 }: { only?: string; limit?: number }) {
  const all = await getMenus();
  const menus = only ? all.filter((m) => m.id === only || m.name.toLowerCase() === only.toLowerCase()) : all.slice(0, limit);
  if (!menus.length) return null;

  return (
    <section className="border-t border-heading/10">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div className="space-y-16">
          {menus.map((m) => (
            <MenuBlock key={m.id} menu={m} />
          ))}
        </div>
      </div>
    </section>
  );
}
