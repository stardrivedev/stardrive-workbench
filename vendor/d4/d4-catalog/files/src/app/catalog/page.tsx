import type { Metadata } from "next";
import { getProducts, getCategories } from "@/modules/catalog/data";
import PageHeader from "@/components/ui/PageHeader";
import CatalogBrowser from "./CatalogBrowser";

export const metadata: Metadata = { title: "Catalog" };
export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const products = await getProducts();
  const categories = await getCategories();

  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title="Catalog"
        subtitle="Browse our products and services by category."
        slot="hero-catalog"
      />
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <CatalogBrowser products={products} categories={categories} />
      </section>
    </>
  );
}
