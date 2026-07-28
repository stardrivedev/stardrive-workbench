"use client";

import { useEffect, useState } from "react";
import { getLegalPagesAction, saveLegalPagesAction } from "../actions";
import type { LegalPage } from "../types";

const inputClass =
  "w-full rounded-md border border-heading/15 bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

export default function LegalEditor() {
  const [pages, setPages] = useState<LegalPage[]>([]);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    getLegalPagesAction().then((res) => {
      if (res.error) setStatus(res.error);
      else {
        setPages(res.pages);
        setOpenSlug(res.pages[0]?.slug ?? null);
      }
    });
  }, []);

  function edit(next: LegalPage[]) {
    setPages(next);
    setDirty(true);
  }

  const patch = (slug: string, p: Partial<LegalPage>) =>
    edit(pages.map((x) => (x.slug === slug ? { ...x, ...p } : x)));

  async function save() {
    setStatus("Saving…");
    const res = await saveLegalPagesAction(pages);
    if (res.success) {
      setDirty(false);
      setStatus("Saved.");
      const again = await getLegalPagesAction();
      if (again.pages.length) setPages(again.pages);
    } else {
      setStatus(res.error ?? "Save failed.");
    }
  }

  const unreviewed = pages.filter((p) => !p.reviewed);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Legal pages</h2>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-sm text-muted">Unsaved changes</span>}
          <button
            type="button"
            onClick={save}
            disabled={!dirty}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-50"
          >
            Save changes
          </button>
        </div>
      </div>

      {status && <p className="text-sm text-muted">{status}</p>}

      <div className="rounded-md border border-heading/15 bg-surface p-4 text-sm">
        <p className="font-medium">These are starting drafts, not legal advice.</p>
        <p className="mt-1 text-muted">
          Read each one end to end, replace everything in [square brackets], delete what does not
          apply to you, and have it checked by someone qualified. A page stays off your website until
          you tick <strong>Reviewed and ready to publish</strong>, so nothing goes live unread.
        </p>
        {unreviewed.length > 0 ? (
          <p className="mt-2">
            {unreviewed.length} page{unreviewed.length === 1 ? " is" : "s are"} still unpublished:{" "}
            {unreviewed.map((p) => p.title).join(", ")}.
          </p>
        ) : null}
      </div>

      <div className="space-y-4">
        {pages.map((page) => {
          const open = openSlug === page.slug;
          return (
            <section key={page.slug} className="rounded-lg border border-heading/15 bg-surface">
              <div className="flex items-center justify-between gap-3 p-4">
                <button
                  type="button"
                  onClick={() => setOpenSlug(open ? null : page.slug)}
                  aria-expanded={open}
                  className="flex-1 text-left text-sm font-semibold"
                >
                  {page.title}
                  <span className="ml-2 font-normal text-muted">
                    {page.reviewed ? `published at /legal/${page.slug}` : "draft, not on the site"}
                  </span>
                </button>
              </div>

              {open && (
                <div className="space-y-4 border-t border-heading/10 p-4">
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium">Title</span>
                    <input value={page.title} onChange={(e) => patch(page.slug, { title: e.target.value })} className={inputClass} />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-sm font-medium">Content (markdown)</span>
                    <textarea
                      value={page.body}
                      onChange={(e) => patch(page.slug, { body: e.target.value })}
                      rows={22}
                      spellCheck
                      className={`${inputClass} font-mono text-xs leading-5`}
                    />
                  </label>

                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(page.reviewed)}
                      onChange={(e) =>
                        patch(page.slug, {
                          reviewed: e.target.checked,
                          // Re-approving after a change restamps the date.
                          updatedAt: e.target.checked ? new Date().toISOString().slice(0, 10) : undefined,
                        })
                      }
                      className="mt-1"
                    />
                    <span>
                      <strong>Reviewed and ready to publish.</strong>
                      <span className="block text-muted">
                        Tick this only once the wording is genuinely yours and has been checked.
                        Until then the page returns &ldquo;not found&rdquo; to visitors.
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
