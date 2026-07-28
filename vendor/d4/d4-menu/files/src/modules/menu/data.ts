/** Server-only accessors for menus. */
import { readCollection, writeCollection } from "@/lib/cms/data-store";
import { seedMenus } from "@/config/menu.generated";
import type { Menu } from "./types";

export function getMenus(): Promise<Menu[]> {
  return readCollection<Menu[]>("menus", seedMenus);
}

export function saveMenus(menus: Menu[]): Promise<void> {
  return writeCollection("menus", menus);
}
