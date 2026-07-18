import type { Metadata } from "next";
import { getProducts, getCategories } from "@/modules/catalog/data";
import CatalogBrowser from "./CatalogBrowser";

export const metadata: Metadata = { title: "Catalog" };
export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const products = await getProducts();
  const categories = await getCategories();

  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Catalog</h1>
      <p className="mt-4 max-w-2xl text-muted">
        Browse our products and services by category.
      </p>
      <div className="mt-10">
        <CatalogBrowser products={products} categories={categories} />
      </div>
    </section>
  );
}
