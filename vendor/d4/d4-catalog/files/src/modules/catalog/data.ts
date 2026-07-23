/** Server-only accessors for catalog collections. */
import { readCollection, writeCollection } from "@/lib/cms/data-store";
import { seedProducts, seedCategories } from "@/config/catalog.generated";
import type { Product, CatalogCategory } from "./types";

export function getProducts(): Promise<Product[]> {
  return readCollection<Product[]>("products", seedProducts);
}

export function saveProducts(products: Product[]): Promise<void> {
  return writeCollection("products", products);
}

export function getCategories(): Promise<CatalogCategory[]> {
  return readCollection<CatalogCategory[]>("catalog-categories", seedCategories);
}

export function saveCategories(categories: CatalogCategory[]): Promise<void> {
  return writeCollection("catalog-categories", categories);
}
