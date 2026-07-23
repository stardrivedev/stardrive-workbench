"use client";

import { useEffect, useState } from "react";
import { getSiteContentAction, saveSiteContentAction } from "@/lib/cms/site-content-actions";
import type { SiteContent } from "@/config/content.generated";

const inputClass =
  "w-full rounded-md border border-heading/15 bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent";
const labelClass = "block text-sm font-medium text-heading";
const hintClass = "mt-1 text-xs text-muted";

/**
 * The "Pages" editor: edit the site's own page copy (headline, about, services,
 * contact, FAQ) and save it to the live site. The whole content object is loaded
 * and saved, so fields this form doesn't expose (and any module-owned sections)
 * are preserved untouched.
 */
export default function SiteContentPanel() {
  const [content, setContent] = useState<SiteContent | null>(null);
  const [status, setStatus] = useState("Loading…");

  useEffect(() => {
    getSiteContentAction().then((res) => {
      if (!res.content) setStatus(res.error || "Could not load your content.");
      else {
        setContent(res.content);
        setStatus("");
      }
    });
  }, []);

  if (!content) return <p className="text-sm text-muted">{status}</p>;

  const c = content;
  const set = (patch: Partial<SiteContent>) => setContent({ ...c, ...patch });
  const setHome = (patch: Partial<SiteContent["home"]>) => set({ home: { ...c.home, ...patch } });
  const setAbout = (patch: Partial<SiteContent["about"]>) => set({ about: { ...c.about, ...patch } });
  const setContact = (patch: Partial<SiteContent["contact"]>) => set({ contact: { ...c.contact, ...patch } });

  // Paragraphs edit as one textarea, a blank line between each paragraph.
  const paragraphsText = c.about.paragraphs.join("\n\n");
  const setParagraphs = (text: string) =>
    setAbout({ paragraphs: text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) });

  const setService = (i: number, patch: Partial<SiteContent["services"][number]>) =>
    set({ services: c.services.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const addService = () => set({ services: [...c.services, { name: "", description: "" }] });
  const removeService = (i: number) => set({ services: c.services.filter((_, j) => j !== i) });

  const setFaq = (i: number, patch: Partial<SiteContent["faq"][number]>) =>
    set({ faq: c.faq.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const addFaq = () => set({ faq: [...c.faq, { question: "", answer: "" }] });
  const removeFaq = (i: number) => set({ faq: c.faq.filter((_, j) => j !== i) });

  async function save() {
    setStatus("Saving…");
    const res = await saveSiteContentAction(content!);
    setStatus(res.success ? "Saved. Your live site updates on the next page load." : res.error || "Save failed.");
  }

  const rowClass = "rounded-md border border-heading/10 bg-surface p-4 space-y-2";
  const smallBtn =
    "rounded-md border border-heading/15 px-3 py-1.5 text-xs transition-colors hover:border-accent hover:text-accent";

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Your pages</h2>
        <div className="flex items-center gap-3">
          {status && <span className="text-sm text-muted">{status}</span>}
          <button
            type="button"
            onClick={save}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong"
          >
            Save changes
          </button>
        </div>
      </div>

      {/* Home hero */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-accent">Home hero</h3>
        <div>
          <label className={labelClass}>Headline</label>
          <input className={inputClass} value={c.tagline} onChange={(e) => set({ tagline: e.target.value })} />
          <p className={hintClass}>The big line at the top of your home page.</p>
        </div>
        <div>
          <label className={labelClass}>Subheading</label>
          <textarea
            className={inputClass}
            rows={2}
            value={c.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>Services section heading</label>
          <input
            className={inputClass}
            value={c.home.introHeading}
            onChange={(e) => setHome({ introHeading: e.target.value })}
          />
        </div>
      </section>

      {/* Services */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-accent">Services</h3>
        {c.services.length === 0 && <p className="text-sm text-muted">No services yet. Add one below.</p>}
        {c.services.map((s, i) => (
          <div key={i} className={rowClass}>
            <input
              className={inputClass}
              placeholder="Service name"
              value={s.name}
              onChange={(e) => setService(i, { name: e.target.value })}
            />
            <textarea
              className={inputClass}
              rows={2}
              placeholder="Short description"
              value={s.description}
              onChange={(e) => setService(i, { description: e.target.value })}
            />
            <button type="button" onClick={() => removeService(i)} className={`${smallBtn} text-red-600 hover:border-red-400`}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={addService} className={smallBtn}>
          + Add service
        </button>
      </section>

      {/* About */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-accent">About page</h3>
        <div>
          <label className={labelClass}>Paragraphs</label>
          <textarea
            className={inputClass}
            rows={6}
            value={paragraphsText}
            onChange={(e) => setParagraphs(e.target.value)}
          />
          <p className={hintClass}>Leave a blank line between paragraphs.</p>
        </div>
        <div>
          <label className={labelClass}>Mission (optional)</label>
          <textarea
            className={inputClass}
            rows={2}
            value={c.about.mission}
            onChange={(e) => setAbout({ mission: e.target.value })}
          />
        </div>
      </section>

      {/* Contact */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-accent">Contact page</h3>
        <div>
          <label className={labelClass}>Heading</label>
          <input
            className={inputClass}
            placeholder="Let's talk"
            value={c.contact.heading}
            onChange={(e) => setContact({ heading: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>Intro</label>
          <textarea
            className={inputClass}
            rows={2}
            placeholder="Send a message and we'll get back to you."
            value={c.contact.intro}
            onChange={(e) => setContact({ intro: e.target.value })}
          />
        </div>
      </section>

      {/* FAQ */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-accent">FAQ</h3>
        {c.faq.length === 0 && <p className="text-sm text-muted">No questions yet. Add one below.</p>}
        {c.faq.map((f, i) => (
          <div key={i} className={rowClass}>
            <input
              className={inputClass}
              placeholder="Question"
              value={f.question}
              onChange={(e) => setFaq(i, { question: e.target.value })}
            />
            <textarea
              className={inputClass}
              rows={2}
              placeholder="Answer"
              value={f.answer}
              onChange={(e) => setFaq(i, { answer: e.target.value })}
            />
            <button type="button" onClick={() => removeFaq(i)} className={`${smallBtn} text-red-600 hover:border-red-400`}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={addFaq} className={smallBtn}>
          + Add question
        </button>
      </section>

      <div className="flex justify-end border-t border-heading/10 pt-5">
        <button
          type="button"
          onClick={save}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong"
        >
          Save changes
        </button>
      </div>
    </div>
  );
}
