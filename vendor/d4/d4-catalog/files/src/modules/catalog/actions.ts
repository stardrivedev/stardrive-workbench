"use server";

import { revalidatePath } from "next/cache";
import { assertAuthenticated } from "@/lib/cms/auth";
import { getProducts, saveProducts, getCategories, saveCategories } from "./data";
import type { Product, CatalogCategory } from "./types";

export async function getCatalogAction(): Promise<{
  products: Product[];
  categories: CatalogCategory[];
  error?: string;
}> {
  try {
    await assertAuthenticated();
    return { products: await getProducts(), categories: await getCategories() };
  } catch (e) {
    return { products: [], categories: [], error: String(e) };
  }
}

export async function saveProductsAction(
  products: Product[]
): Promise<{ success: boolean; error?: string }> {
  try {
    await assertAuthenticated();
    await saveProducts(products);
    revalidatePath("/catalog");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function saveCategoriesAction(
  categories: CatalogCategory[]
): Promise<{ success: boolean; error?: string }> {
  try {
    await assertAuthenticated();
    await saveCategories(categories);
    revalidatePath("/catalog");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
