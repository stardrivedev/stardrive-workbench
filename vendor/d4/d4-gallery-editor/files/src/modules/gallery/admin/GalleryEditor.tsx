"use client";

import { useEffect, useState } from "react";
import ImageDropzone from "@/components/cms/ImageDropzone";
import { getGalleriesAction, saveGalleryAction, deleteGalleryAction } from "../actions";
import type { Galleries, GalleryImage } from "../types";

const inputClass =
  "w-full rounded-md border border-heading/15 bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export default function GalleryEditor() {
  const [galleries, setGalleries] = useState<Galleries>({});
  const [active, setActive] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    getGalleriesAction().then((res) => {
      if (res.error) setStatus(res.error);
      else {
        setGalleries(res.galleries);
        setActive(Object.keys(res.galleries)[0] ?? "");
      }
    });
  }, []);

  const images = galleries[active] ?? [];

  async function persist(slug: string, next: GalleryImage[]) {
    setGalleries({ ...galleries, [slug]: next });
    setStatus("Saving…");
    const res = await saveGalleryAction(slug, next);
    setStatus(res.success ? "Saved." : res.error ?? "Save failed.");
  }

  function createGallery() {
    const slug = slugify(newSlug);
    if (!slug || galleries[slug]) return;
    setGalleries({ ...galleries, [slug]: [] });
    setActive(slug);
    setNewSlug("");
    saveGalleryAction(slug, []);
  }

  async function removeGallery(slug: string) {
    const next = { ...galleries };
    delete next[slug];
    setGalleries(next);
    setActive(Object.keys(next)[0] ?? "");
    setStatus("Saving…");
    const res = await deleteGalleryAction(slug);
    setStatus(res.success ? "Saved." : res.error ?? "Save failed.");
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= images.length) return;
    const next = [...images];
    [next[i], next[j]] = [next[j], next[i]];
    persist(active, next);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-lg font-semibold">Galleries</h2>
        {Object.keys(galleries).map((slug) => (
          <button
            key={slug}
            type="button"
            onClick={() => setActive(slug)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
              slug === active
                ? "bg-accent font-medium text-white"
                : "border border-heading/15 text-body hover:border-accent hover:text-accent"
            }`}
          >
            {slug}
          </button>
        ))}
        <div className="flex gap-2">
          <input
            value={newSlug}
            onChange={(e) => setNewSlug(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), createGallery())}
            placeholder="new-gallery-slug"
            className={`${inputClass} w-44`}
          />
          <button
            type="button"
            onClick={createGallery}
            className="rounded-md border border-heading/15 px-3 py-1.5 text-sm hover:border-accent hover:text-accent"
          >
            Create
          </button>
        </div>
      </div>

      {status && <p className="text-sm text-muted">{status}</p>}

      {!active ? (
        <p className="text-sm text-muted">
          No galleries yet. Create one above; the public /gallery page shows the gallery
          named <code>main</code>.
        </p>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">
              Editing <span className="font-medium text-heading">{active}</span> ·{" "}
              {images.length} image{images.length === 1 ? "" : "s"}
            </p>
            <button
              type="button"
              onClick={() => removeGallery(active)}
              className="rounded-md border border-heading/15 px-3 py-1.5 text-xs text-red-600 hover:border-red-400"
            >
              Delete gallery
            </button>
          </div>

          <ImageDropzone
            label="Drop an image here or click to add it to this gallery"
            onUploaded={(url) =>
              persist(active, [
                ...images,
                { id: `img-${Date.now().toString(36)}`, url, alt: "" },
              ])
            }
          />

          <ul className="space-y-3">
            {images.map((img, i) => (
              <li
                key={img.id}
                className="flex items-center gap-4 rounded-md border border-heading/10 bg-surface px-4 py-3"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.alt} className="h-14 w-20 rounded object-cover" />
                <input
                  value={img.alt}
                  onChange={(e) =>
                    setGalleries({
                      ...galleries,
                      [active]: images.map((x, j) =>
                        j === i ? { ...x, alt: e.target.value } : x
                      ),
                    })
                  }
                  onBlur={() => persist(active, images)}
                  placeholder="Alt text (describe the image)"
                  className={inputClass}
                />
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    aria-label="Move up"
                    onClick={() => move(i, -1)}
                    className="rounded-md border border-heading/15 px-2.5 py-1.5 text-xs hover:border-accent"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    onClick={() => move(i, 1)}
                    className="rounded-md border border-heading/15 px-2.5 py-1.5 text-xs hover:border-accent"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label="Remove image"
                    onClick={() => persist(active, images.filter((_, j) => j !== i))}
                    className="rounded-md border border-heading/15 px-2.5 py-1.5 text-xs text-red-600 hover:border-red-400"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
