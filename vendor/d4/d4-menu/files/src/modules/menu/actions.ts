"use server";

import { revalidatePath } from "next/cache";
import { assertAuthenticated } from "@/lib/cms/auth";
import { getMenus, saveMenus } from "./data";
import type { Menu } from "./types";

export async function getMenusAction(): Promise<{ menus: Menu[]; error?: string }> {
  try {
    await assertAuthenticated();
    return { menus: await getMenus() };
  } catch (e) {
    return { menus: [], error: String(e) };
  }
}

export async function saveMenusAction(menus: Menu[]): Promise<{ success: boolean; error?: string }> {
  try {
    await assertAuthenticated();
    await saveMenus(menus);
    revalidatePath("/menu");
    revalidatePath("/");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
