"use client";

import { useEffect, useState } from "react";
import ImageDropzone from "@/components/cms/ImageDropzone";
import { getTestimonialsAction, saveTestimonialsAction } from "../actions";
import type { Testimonial } from "../types";

const inputClass =
  "w-full rounded-md border border-heading/15 bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

function emptyTestimonial(): Testimonial {
  return {
    id: `tst-${Date.now().toString(36)}`,
    quote: "",
    author: "",
    role: "",
    date: new Date().toISOString().slice(0, 10),
    featured: true,
  };
}

export default function TestimonialsEditor() {
  const [items, setItems] = useState<Testimonial[]>([]);
  const [editing, setEditing] = useState<Testimonial | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    getTestimonialsAction().then((res) => {
      if (res.error) setStatus(res.error);
      else setItems(res.testimonials);
    });
  }, []);

  async function persist(next: Testimonial[]) {
    setItems(next);
    setStatus("Saving…");
    const res = await saveTestimonialsAction(next);
    setStatus(res.success ? "Saved." : res.error ?? "Save failed.");
  }

  function submitEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const data = new FormData(e.currentTarget);
    const ratingRaw = String(data.get("rating") ?? "").trim();
    const updated: Testimonial = {
      ...editing,
      quote: String(data.get("quote") ?? "").trim(),
      author: String(data.get("author") ?? "").trim(),
      role: String(data.get("role") ?? "").trim() || undefined,
      date: String(data.get("date") ?? "").trim() || undefined,
      featured: data.get("featured") === "on",
      // No rating chosen stays no rating. Defaulting to five would be
      // inventing a score the customer never gave.
      rating: ratingRaw ? Number(ratingRaw) : undefined,
    };
    if (!updated.quote || !updated.author) {
      setStatus("A quote and an author are required.");
      return;
    }
    const exists = items.some((t) => t.id === updated.id);
    persist(exists ? items.map((t) => (t.id === updated.id ? updated : t)) : [...items, updated]);
    setEditing(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Testimonials</h2>
        <button
          type="button"
          onClick={() => setEditing(emptyTestimonial())}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong"
        >
          Add testimonial
        </button>
      </div>

      {status && <p className="text-sm text-muted">{status}</p>}

      {editing && (
        <form onSubmit={submitEdit} className="space-y-4 rounded-lg border border-heading/15 bg-surface p-5">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="quote">What they said</label>
            <textarea id="quote" name="quote" rows={4} defaultValue={editing.quote} className={inputClass} required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="author">Who said it</label>
              <input id="author" name="author" defaultValue={editing.author} className={inputClass} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="role">Role or company (optional)</label>
              <input id="role" name="role" defaultValue={editing.role ?? ""} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="rating">Rating (optional)</label>
              <select id="rating" name="rating" defaultValue={editing.rating ? String(editing.rating) : ""} className={inputClass}>
                <option value="">No rating</option>
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>{n} out of 5</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="date">Date</label>
              <input id="date" name="date" type="date" defaultValue={editing.date ?? ""} className={inputClass} />
            </div>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium">Photo (optional)</span>
            {editing.photo ? (
              <div className="mb-2 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={editing.photo} alt="" className="h-12 w-12 rounded-full object-cover" />
                <button
                  type="button"
                  onClick={() => setEditing({ ...editing, photo: undefined })}
                  className="text-sm text-muted underline"
                >
                  Remove
                </button>
              </div>
            ) : null}
            <ImageDropzone onUploaded={(url) => setEditing({ ...editing, photo: url })} label="Add a headshot or logo" />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="featured" defaultChecked={editing.featured !== false} />
            Show in testimonial strips on other pages
          </label>

          <div className="flex gap-3">
            <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong">
              Save testimonial
            </button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-heading/15 px-4 py-2 text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted">No testimonials yet. Add the first one above.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-4 rounded-lg border border-heading/10 bg-surface p-4">
              <div className="min-w-0">
                <p className="truncate text-sm">&ldquo;{t.quote}&rdquo;</p>
                <p className="mt-1 text-xs text-muted">
                  {t.author}
                  {t.role ? `, ${t.role}` : ""}
                  {typeof t.rating === "number" ? ` · ${t.rating}/5` : ""}
                  {t.featured === false ? " · not featured" : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-3 text-sm">
                <button type="button" onClick={() => setEditing(t)} className="underline">Edit</button>
                <button
                  type="button"
                  onClick={() => persist(items.filter((x) => x.id !== t.id))}
                  className="text-muted underline"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
