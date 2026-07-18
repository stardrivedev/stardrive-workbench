"use client";

import { useEffect, useState } from "react";
import ImageDropzone from "@/components/cms/ImageDropzone";
import { getCatalogAction, saveProductsAction, saveCategoriesAction } from "../actions";
import type { Product, CatalogCategory, ProductSpec } from "../types";

const inputClass =
  "w-full rounded-md border border-heading/15 bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export default function CatalogEditor() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [editing, setEditing] = useState<Product | null>(null);
  const [specs, setSpecs] = useState<ProductSpec[]>([]);
  const [image, setImage] = useState<string | undefined>(undefined);
  const [newCategory, setNewCategory] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    getCatalogAction().then((res) => {
      if (res.error) setStatus(res.error);
      else {
        setProducts(res.products);
        setCategories(res.categories);
      }
    });
  }, []);

  async function persistProducts(next: Product[]) {
    setProducts(next);
    setStatus("Saving…");
    const res = await saveProductsAction(next);
    setStatus(res.success ? "Saved." : res.error ?? "Save failed.");
  }

  async function persistCategories(next: CatalogCategory[]) {
    setCategories(next);
    setStatus("Saving…");
    const res = await saveCategoriesAction(next);
    setStatus(res.success ? "Saved." : res.error ?? "Save failed.");
  }

  function addCategory() {
    const label = newCategory.trim();
    if (!label) return;
    const id = slugify(label);
    if (categories.some((c) => c.id === id)) return;
    persistCategories([...categories, { id, label }]);
    setNewCategory("");
  }

  function startEdit(p: Product) {
    setEditing(p);
    setSpecs(p.specs);
    setImage(p.image);
  }

  function submitEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const data = new FormData(e.currentTarget);
    const updated: Product = {
      ...editing,
      title: String(data.get("title") ?? "").trim(),
      category: String(data.get("category") ?? ""),
      description: String(data.get("description") ?? "").trim(),
      partNumber: String(data.get("partNumber") ?? "").trim() || undefined,
      link: String(data.get("link") ?? "").trim() || undefined,
      specs: specs.filter((s) => s.label.trim() && s.value.trim()),
      image,
    };
    const exists = products.some((p) => p.id === updated.id);
    persistProducts(
      exists ? products.map((p) => (p.id === updated.id ? updated : p)) : [...products, updated]
    );
    setEditing(null);
    setSpecs([]);
    setImage(undefined);
  }

  return (
    <div className="space-y-10">
      <section>
        <h2 className="text-lg font-semibold">Categories</h2>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {categories.map((c) => (
            <span
              key={c.id}
              className="flex items-center gap-2 rounded-full border border-heading/15 px-3 py-1 text-sm"
            >
              {c.label}
              <button
                type="button"
                aria-label={`Delete ${c.label}`}
                onClick={() => persistCategories(categories.filter((x) => x.id !== c.id))}
                className="text-muted hover:text-red-600"
              >
                ×
              </button>
            </span>
          ))}
          <div className="flex gap-2">
            <input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCategory())}
              placeholder="New category"
              className={`${inputClass} w-44`}
            />
            <button
              type="button"
              onClick={addCategory}
              className="rounded-md border border-heading/15 px-3 py-1.5 text-sm hover:border-accent hover:text-accent"
            >
              Add
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Products</h2>
          <button
            type="button"
            onClick={() =>
              startEdit({
                id: `prod-${Date.now().toString(36)}`,
                title: "",
                category: categories[0]?.id ?? "",
                description: "",
                specs: [],
              })
            }
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong"
          >
            Add product
          </button>
        </div>

        {status && <p className="text-sm text-muted">{status}</p>}

        {editing && (
          <form
            onSubmit={submitEdit}
            className="space-y-4 rounded-md border border-heading/10 bg-surface p-5"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Title</span>
                <input name="title" defaultValue={editing.title} required className={inputClass} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Category</span>
                <select name="category" defaultValue={editing.category} className={inputClass}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Part number (optional)</span>
                <input name="partNumber" defaultValue={editing.partNumber ?? ""} className={inputClass} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">External link (optional)</span>
                <input name="link" type="url" defaultValue={editing.link ?? ""} className={inputClass} />
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Description</span>
              <textarea
                name="description"
                defaultValue={editing.description}
                required
                rows={4}
                className={inputClass}
              />
            </label>

            <div className="text-sm">
              <span className="mb-1 block font-medium">Image</span>
              {image ? (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image} alt="" className="h-20 w-32 rounded-md object-cover" />
                  <button
                    type="button"
                    onClick={() => setImage(undefined)}
                    className="rounded-md border border-heading/15 px-3 py-1.5 text-xs text-red-600 hover:border-red-400"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <ImageDropzone onUploaded={setImage} />
              )}
            </div>

            <div className="text-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium">Specifications</span>
                <button
                  type="button"
                  onClick={() => setSpecs([...specs, { label: "", value: "" }])}
                  className="rounded-md border border-heading/15 px-3 py-1 text-xs hover:border-accent hover:text-accent"
                >
                  Add spec
                </button>
              </div>
              {specs.map((s, i) => (
                <div key={i} className="mb-2 flex gap-2">
                  <input
                    value={s.label}
                    onChange={(e) =>
                      setSpecs(specs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                    }
                    placeholder="Label"
                    className={inputClass}
                  />
                  <input
                    value={s.value}
                    onChange={(e) =>
                      setSpecs(specs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                    }
                    placeholder="Value"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    aria-label="Remove spec"
                    onClick={() => setSpecs(specs.filter((_, j) => j !== i))}
                    className="shrink-0 rounded-md border border-heading/15 px-3 text-muted hover:text-red-600"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong"
              >
                Save product
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setSpecs([]);
                  setImage(undefined);
                }}
                className="rounded-md border border-heading/15 px-4 py-2 text-sm hover:border-accent"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {products.length === 0 && !editing ? (
          <p className="text-sm text-muted">No products yet.</p>
        ) : (
          <ul className="space-y-3">
            {products.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-4 rounded-md border border-heading/10 bg-surface px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  {p.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image} alt="" className="h-10 w-14 rounded object-cover" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-heading">{p.title || "(untitled)"}</p>
                    <p className="text-xs text-muted">
                      {categories.find((c) => c.id === p.category)?.label ?? p.category}
                      {p.partNumber ? ` · ${p.partNumber}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => startEdit(p)}
                    className="rounded-md border border-heading/15 px-3 py-1.5 text-xs hover:border-accent hover:text-accent"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => persistProducts(products.filter((x) => x.id !== p.id))}
                    className="rounded-md border border-heading/15 px-3 py-1.5 text-xs text-red-600 hover:border-red-400"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
