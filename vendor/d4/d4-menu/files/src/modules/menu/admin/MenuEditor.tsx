"use client";

import { useEffect, useState } from "react";
import { getMenusAction, saveMenusAction } from "../actions";
import { DIET_MARKERS } from "../types";
import type { Course, DietMarker, Dish, Menu } from "../types";

const inputClass =
  "w-full rounded-md border border-heading/15 bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent";
const smallInput =
  "rounded-md border border-heading/15 bg-surface px-2 py-1.5 text-sm outline-none transition-colors focus:border-accent";

const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const newDish = (): Dish => ({ id: uid("dish"), name: "" });
const newCourse = (): Course => ({ id: uid("crs"), name: "New course", dishes: [newDish()] });
const newMenu = (): Menu => ({ id: uid("menu"), name: "New menu", courses: [newCourse()] });

/** Swap two array entries, returning a new array. */
function moved<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export default function MenuEditor() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    getMenusAction().then((res) => {
      if (res.error) setStatus(res.error);
      else {
        setMenus(res.menus);
        setOpenMenu(res.menus[0]?.id ?? null);
      }
    });
  }, []);

  /** Every edit goes through here, so "unsaved" is never wrong. */
  function edit(next: Menu[]) {
    setMenus(next);
    setDirty(true);
  }

  async function save() {
    setStatus("Saving…");
    const res = await saveMenusAction(menus);
    if (res.success) {
      setDirty(false);
      setStatus("Saved.");
    } else {
      setStatus(res.error ?? "Save failed.");
    }
  }

  const patchMenu = (id: string, patch: Partial<Menu>) =>
    edit(menus.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const patchCourse = (menuId: string, courseId: string, patch: Partial<Course>) =>
    patchMenu(menuId, {
      courses: (menus.find((m) => m.id === menuId)?.courses ?? []).map((c) =>
        c.id === courseId ? { ...c, ...patch } : c
      ),
    });

  function patchDish(menuId: string, courseId: string, dishId: string, patch: Partial<Dish>) {
    const course = menus.find((m) => m.id === menuId)?.courses.find((c) => c.id === courseId);
    if (!course) return;
    patchCourse(menuId, courseId, {
      dishes: course.dishes.map((d) => (d.id === dishId ? { ...d, ...patch } : d)),
    });
  }

  function toggleMarker(menuId: string, courseId: string, dish: Dish, marker: DietMarker, on: boolean) {
    const current = new Set(dish.markers ?? []);
    if (on) current.add(marker);
    else current.delete(marker);
    patchDish(menuId, courseId, dish.id, { markers: current.size ? [...current] : undefined });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Menus</h2>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-sm text-muted">Unsaved changes</span>}
          <button
            type="button"
            onClick={() => edit([...menus, newMenu()])}
            className="rounded-md border border-heading/15 px-4 py-2 text-sm"
          >
            Add menu
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-50"
          >
            Save changes
          </button>
        </div>
      </div>

      {status && <p className="text-sm text-muted">{status}</p>}

      {menus.length === 0 ? (
        <p className="text-sm text-muted">No menus yet. Add one above.</p>
      ) : null}

      <div className="space-y-4">
        {menus.map((menu, menuIndex) => {
          const open = openMenu === menu.id;
          return (
            <section key={menu.id} className="rounded-lg border border-heading/15 bg-surface">
              <div className="flex items-center justify-between gap-3 p-4">
                <button
                  type="button"
                  onClick={() => setOpenMenu(open ? null : menu.id)}
                  aria-expanded={open}
                  className="flex-1 text-left text-sm font-semibold"
                >
                  {menu.name || "Untitled menu"}
                  <span className="ml-2 font-normal text-muted">
                    {menu.courses.length} course{menu.courses.length === 1 ? "" : "s"}
                  </span>
                </button>
                <div className="flex shrink-0 gap-3 text-sm">
                  <button type="button" onClick={() => edit(moved(menus, menuIndex, -1))} disabled={menuIndex === 0} className="disabled:opacity-30" aria-label="Move menu up">↑</button>
                  <button type="button" onClick={() => edit(moved(menus, menuIndex, 1))} disabled={menuIndex === menus.length - 1} className="disabled:opacity-30" aria-label="Move menu down">↓</button>
                  <button type="button" onClick={() => edit(menus.filter((m) => m.id !== menu.id))} className="text-muted underline">Delete</button>
                </div>
              </div>

              {open && (
                <div className="space-y-6 border-t border-heading/10 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium">Menu name</span>
                      <input value={menu.name} onChange={(e) => patchMenu(menu.id, { name: e.target.value })} className={inputClass} />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium">When it is served</span>
                      <input
                        value={menu.servedWhen ?? ""}
                        onChange={(e) => patchMenu(menu.id, { servedWhen: e.target.value || undefined })}
                        placeholder="Served 12pm to 3pm, Tuesday to Sunday"
                        className={inputClass}
                      />
                    </label>
                  </div>

                  {menu.courses.map((course, courseIndex) => (
                    <div key={course.id} className="rounded-md border border-heading/10 p-4">
                      <div className="flex items-center gap-3">
                        <input
                          value={course.name}
                          onChange={(e) => patchCourse(menu.id, course.id, { name: e.target.value })}
                          className={`${smallInput} flex-1 font-semibold`}
                          aria-label="Course name"
                        />
                        <button type="button" onClick={() => patchMenu(menu.id, { courses: moved(menu.courses, courseIndex, -1) })} disabled={courseIndex === 0} className="text-sm disabled:opacity-30" aria-label="Move course up">↑</button>
                        <button type="button" onClick={() => patchMenu(menu.id, { courses: moved(menu.courses, courseIndex, 1) })} disabled={courseIndex === menu.courses.length - 1} className="text-sm disabled:opacity-30" aria-label="Move course down">↓</button>
                        <button
                          type="button"
                          onClick={() => patchMenu(menu.id, { courses: menu.courses.filter((c) => c.id !== course.id) })}
                          className="text-sm text-muted underline"
                        >
                          Remove
                        </button>
                      </div>

                      <ul className="mt-4 space-y-4">
                        {course.dishes.map((dish, dishIndex) => (
                          <li key={dish.id} className="rounded border border-heading/10 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                value={dish.name}
                                onChange={(e) => patchDish(menu.id, course.id, dish.id, { name: e.target.value })}
                                placeholder="Dish name"
                                className={`${smallInput} min-w-0 flex-1`}
                                aria-label="Dish name"
                              />
                              <input
                                value={dish.price ?? ""}
                                onChange={(e) => patchDish(menu.id, course.id, dish.id, { price: e.target.value || undefined })}
                                placeholder="Price"
                                className={`${smallInput} w-24`}
                                aria-label="Price"
                              />
                              <button type="button" onClick={() => patchCourse(menu.id, course.id, { dishes: moved(course.dishes, dishIndex, -1) })} disabled={dishIndex === 0} className="text-sm disabled:opacity-30" aria-label="Move dish up">↑</button>
                              <button type="button" onClick={() => patchCourse(menu.id, course.id, { dishes: moved(course.dishes, dishIndex, 1) })} disabled={dishIndex === course.dishes.length - 1} className="text-sm disabled:opacity-30" aria-label="Move dish down">↓</button>
                              <button
                                type="button"
                                onClick={() => patchCourse(menu.id, course.id, { dishes: course.dishes.filter((d) => d.id !== dish.id) })}
                                className="text-sm text-muted underline"
                              >
                                Remove
                              </button>
                            </div>

                            <textarea
                              value={dish.description ?? ""}
                              onChange={(e) => patchDish(menu.id, course.id, dish.id, { description: e.target.value || undefined })}
                              placeholder="Description"
                              rows={2}
                              className={`${inputClass} mt-2`}
                              aria-label="Dish description"
                            />

                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                              {(Object.keys(DIET_MARKERS) as DietMarker[]).map((m) => (
                                <label key={m} className="flex items-center gap-1.5 text-xs">
                                  <input
                                    type="checkbox"
                                    checked={(dish.markers ?? []).includes(m)}
                                    onChange={(e) => toggleMarker(menu.id, course.id, dish, m, e.target.checked)}
                                  />
                                  {DIET_MARKERS[m]}
                                </label>
                              ))}
                              <label className="flex items-center gap-1.5 text-xs">
                                <input
                                  type="checkbox"
                                  checked={Boolean(dish.unavailable)}
                                  onChange={(e) => patchDish(menu.id, course.id, dish.id, { unavailable: e.target.checked || undefined })}
                                />
                                Off today
                              </label>
                            </div>

                            <input
                              value={dish.allergenNote ?? ""}
                              onChange={(e) => patchDish(menu.id, course.id, dish.id, { allergenNote: e.target.value || undefined })}
                              placeholder="Allergen note (optional)"
                              className={`${inputClass} mt-2`}
                              aria-label="Allergen note"
                            />
                          </li>
                        ))}
                      </ul>

                      <button
                        type="button"
                        onClick={() => patchCourse(menu.id, course.id, { dishes: [...course.dishes, newDish()] })}
                        className="mt-3 text-sm underline"
                      >
                        Add dish
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() => patchMenu(menu.id, { courses: [...menu.courses, newCourse()] })}
                    className="rounded-md border border-heading/15 px-4 py-2 text-sm"
                  >
                    Add course
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
