"use client";

import { useEffect, useState } from "react";
import ImageDropzone from "@/components/cms/ImageDropzone";
import { getArticlesAction, saveArticlesAction } from "../actions";
import type { Article } from "../types";

const inputClass =
  "w-full rounded-md border border-heading/15 bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function emptyArticle(): Article {
  return {
    id: `draft-${Date.now().toString(36)}`,
    title: "",
    subtitle: "",
    date: new Date().toISOString().slice(0, 10),
    body: "",
    tags: [],
  };
}

export default function ArticlesEditor() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [editing, setEditing] = useState<Article | null>(null);
  const [image, setImage] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState("");

  useEffect(() => {
    getArticlesAction().then((res) => {
      if (res.error) setStatus(res.error);
      else setArticles(res.articles);
    });
  }, []);

  async function persist(next: Article[]) {
    setArticles(next);
    setStatus("Saving…");
    const res = await saveArticlesAction(next);
    setStatus(res.success ? "Saved." : res.error ?? "Save failed.");
  }

  function startEdit(article: Article) {
    setEditing(article);
    setImage(article.image);
  }

  function submitEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const data = new FormData(e.currentTarget);
    const title = String(data.get("title") ?? "").trim();
    const isNew = editing.id.startsWith("draft-");
    const updated: Article = {
      ...editing,
      id: isNew ? slugify(title) || editing.id : editing.id,
      title,
      subtitle: String(data.get("subtitle") ?? "").trim(),
      date: String(data.get("date") ?? "").trim() || editing.date,
      author: String(data.get("author") ?? "").trim() || undefined,
      body: String(data.get("body") ?? ""),
      tags: String(data.get("tags") ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      image,
    };
    const exists = articles.some((a) => a.id === editing.id);
    persist(
      exists ? articles.map((a) => (a.id === editing.id ? updated : a)) : [...articles, updated]
    );
    setEditing(null);
    setImage(undefined);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Articles</h2>
        <button
          type="button"
          onClick={() => startEdit(emptyArticle())}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong"
        >
          New article
        </button>
      </div>

      {status && <p className="text-sm text-muted">{status}</p>}

      {editing && (
        <form
          onSubmit={submitEdit}
          className="space-y-4 rounded-md border border-heading/10 bg-surface p-5"
        >
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Title</span>
            <input name="title" defaultValue={editing.title} required className={inputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Subtitle</span>
            <input name="subtitle" defaultValue={editing.subtitle} className={inputClass} />
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Date</span>
              <input name="date" type="date" defaultValue={editing.date} className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Author</span>
              <input name="author" defaultValue={editing.author ?? ""} className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Tags (comma separated)</span>
              <input name="tags" defaultValue={editing.tags.join(", ")} className={inputClass} />
            </label>
          </div>
          <div className="text-sm">
            <span className="mb-1 block font-medium">Cover image</span>
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
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Body (markdown)</span>
            <textarea
              name="body"
              defaultValue={editing.body}
              required
              rows={14}
              className={`${inputClass} font-mono`}
              placeholder={"## Heading\n\nParagraph text with **bold** and [links](https://example.com).\n\n- List item"}
            />
          </label>
          <div className="flex gap-3">
            <button
              type="submit"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong"
            >
              Save article
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setImage(undefined);
              }}
              className="rounded-md border border-heading/15 px-4 py-2 text-sm hover:border-accent"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {articles.length === 0 && !editing ? (
        <p className="text-sm text-muted">No articles yet.</p>
      ) : (
        <ul className="space-y-3">
          {articles.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-4 rounded-md border border-heading/10 bg-surface px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium text-heading">{a.title || "(untitled)"}</p>
                <p className="text-xs text-muted">
                  {a.date}
                  {a.tags.length ? ` · ${a.tags.join(", ")}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(a)}
                  className="rounded-md border border-heading/15 px-3 py-1.5 text-xs hover:border-accent hover:text-accent"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => persist(articles.filter((x) => x.id !== a.id))}
                  className="rounded-md border border-heading/15 px-3 py-1.5 text-xs text-red-600 hover:border-red-400"
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
