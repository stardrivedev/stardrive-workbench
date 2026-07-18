/** Server-only accessors for catalog collections. */
import { readCollection, writeCollection } from "@/lib/cms/data-store";
import type { Product, CatalogCategory } from "./types";

export function getProducts(): Promise<Product[]> {
  return readCollection<Product[]>("products", []);
}

export function saveProducts(products: Product[]): Promise<void> {
  return writeCollection("products", products);
}

export function getCategories(): Promise<CatalogCategory[]> {
  return readCollection<CatalogCategory[]>("catalog-categories", []);
}

export function saveCategories(categories: CatalogCategory[]): Promise<void> {
  return writeCollection("catalog-categories", categories);
}
