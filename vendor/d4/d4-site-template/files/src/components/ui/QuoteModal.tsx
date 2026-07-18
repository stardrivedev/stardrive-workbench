"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { siteConfig, quoteConfig } from "@/config/site";
import { QUOTE_MODAL_EVENT, type QuoteModalDetail } from "@/components/ui/QuoteButton";

type Status = "idle" | "sending" | "success" | "error";

const emptyForm = { name: "", company: "", email: "", phone: "", topic: "", message: "" };

/**
 * Site-wide quote-request modal, opened from anywhere via QuoteButton
 * (a d4:open-quote-modal CustomEvent). Submits through the same
 * /api/contact route as the contact form. Mounted once in the root layout
 * when quoteConfig.enabled.
 */
export default function QuoteModal() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState<Status>("idle");
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<QuoteModalDetail>).detail;
      if (detail) setForm((prev) => ({ ...prev, ...detail }));
      setOpen(true);
    };
    window.addEventListener(QUOTE_MODAL_EVENT, handler);
    return () => window.removeEventListener(QUOTE_MODAL_EVENT, handler);
  }, []);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      setTimeout(() => firstInputRef.current?.focus(), 50);
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    if (status === "success") {
      const t = setTimeout(() => close(), 4000);
      return () => clearTimeout(t);
    }
  }, [status]);

  function close() {
    setOpen(false);
    setTimeout(() => {
      setForm(emptyForm);
      setStatus("idle");
    }, 300);
  }

  function update(field: keyof typeof emptyForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setStatus(res.ok ? "success" : "error");
    } catch {
      setStatus("error");
    }
  }

  if (!open) return null;

  const labelClass = "mb-1.5 block text-xs font-medium uppercase tracking-widest text-muted";
  const inputClass =
    "w-full rounded-md border border-heading/15 bg-base px-3 py-2.5 text-sm text-body outline-none focus:border-accent";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Request a quote"
    >
      <div className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-heading/10 bg-surface shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-heading/10 bg-surface px-6 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-accent">
              {siteConfig.name}
            </p>
            <h2 className="text-lg font-bold text-heading">Request a quote</h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded-md p-2 text-muted transition-colors hover:text-heading"
          >
            <svg aria-hidden className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-6">
          {status === "success" ? (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-accent/30 bg-accent/10">
                <svg aria-hidden className="h-7 w-7 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="mb-2 text-xl font-bold text-heading">We&apos;ll be in touch.</h3>
              <p className="mb-6 text-sm leading-relaxed text-muted">
                Your request has been received. Expect a response within one business day.
              </p>
              <button type="button" onClick={close} className="btn-outline text-sm">
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="quote-name" className={labelClass}>
                    Name <span className="text-accent">*</span>
                  </label>
                  <input
                    id="quote-name"
                    ref={firstInputRef}
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => update("name", e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="quote-company" className={labelClass}>
                    Company
                  </label>
                  <input
                    id="quote-company"
                    type="text"
                    value={form.company}
                    onChange={(e) => update("company", e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="quote-email" className={labelClass}>
                    Email <span className="text-accent">*</span>
                  </label>
                  <input
                    id="quote-email"
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => update("email", e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="quote-phone" className={labelClass}>
                    Phone
                  </label>
                  <input
                    id="quote-phone"
                    type="tel"
                    value={form.phone}
                    onChange={(e) => update("phone", e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              {quoteConfig.topics.length > 0 && (
                <div className="mb-4">
                  <label htmlFor="quote-topic" className={labelClass}>
                    What is this about?
                  </label>
                  <select
                    id="quote-topic"
                    value={form.topic}
                    onChange={(e) => update("topic", e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Select…</option>
                    {quoteConfig.topics.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="mb-5">
                <label htmlFor="quote-message" className={labelClass}>
                  Message <span className="text-accent">*</span>
                </label>
                <textarea
                  id="quote-message"
                  required
                  rows={4}
                  value={form.message}
                  onChange={(e) => update("message", e.target.value)}
                  placeholder="Describe what you need…"
                  className={`${inputClass} resize-y`}
                />
              </div>

              {status === "error" && (
                <div className="mb-4 rounded-md border border-red-600/25 bg-red-600/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                  Something went wrong. Please try again
                  {siteConfig.contactEmail ? (
                    <>
                      {" "}
                      or{" "}
                      <a href={`mailto:${siteConfig.contactEmail}`} className="underline">
                        email us directly
                      </a>
                    </>
                  ) : null}
                  .
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={status === "sending"}
                  className="btn-primary px-8 text-sm disabled:opacity-70"
                >
                  {status === "sending" ? "Sending…" : "Send request"}
                </button>
                {siteConfig.phone && (
                  <span className="flex items-center gap-2 text-xs text-muted">
                    or
                    <a
                      href={`tel:${siteConfig.phone.replace(/[^\d+]/g, "")}`}
                      className="btn-outline px-3 py-2 text-xs"
                    >
                      Call {siteConfig.phone}
                    </a>
                  </span>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
