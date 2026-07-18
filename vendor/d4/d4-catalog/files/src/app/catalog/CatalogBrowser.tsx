"use client";

import { useState } from "react";
import type { Product, CatalogCategory } from "@/modules/catalog/types";

export default function CatalogBrowser({
  products,
  categories,
}: {
  products: Product[];
  categories: CatalogCategory[];
}) {
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const visible =
    activeCategory === "all"
      ? products
      : products.filter((p) => p.category === activeCategory);

  if (products.length === 0) {
    return (
      <div className="rounded-md border border-heading/10 bg-surface px-6 py-8 text-sm text-muted">
        The catalog is empty right now. Check back soon.
      </div>
    );
  }

  return (
    <div>
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveCategory("all")}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
              activeCategory === "all"
                ? "bg-accent font-medium text-white"
                : "border border-heading/15 text-body hover:border-accent hover:text-accent"
            }`}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveCategory(c.id)}
              className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                activeCategory === c.id
                  ? "bg-accent font-medium text-white"
                  : "border border-heading/15 text-body hover:border-accent hover:text-accent"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((p) => (
          <article
            key={p.id}
            className="flex flex-col rounded-lg border border-heading/10 bg-surface p-5"
          >
            {p.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.image}
                alt={p.title}
                className="mb-4 h-40 w-full rounded-md object-cover"
              />
            )}
            <h2 className="text-base font-semibold">{p.title}</h2>
            {p.partNumber && (
              <p className="mt-0.5 text-xs text-muted">Part no. {p.partNumber}</p>
            )}
            <p className="mt-2 flex-1 text-sm leading-6 text-body">{p.description}</p>
            {p.specs.length > 0 && (
              <table className="mt-4 w-full text-xs">
                <tbody>
                  {p.specs.map((s, i) => (
                    <tr key={i} className="border-t border-heading/10">
                      <td className="py-1.5 pr-2 font-medium text-heading">{s.label}</td>
                      <td className="py-1.5 text-muted">{s.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {p.link && (
              <a
                href={p.link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 text-sm font-medium text-accent hover:underline"
              >
                Learn more
              </a>
            )}
          </article>
        ))}
      </div>

      {visible.length === 0 && (
        <p className="mt-8 text-sm text-muted">No items in this category yet.</p>
      )}
    </div>
  );
}
