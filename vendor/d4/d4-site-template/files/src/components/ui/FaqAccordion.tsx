"use client";

import { useState } from "react";
import type { FaqItem } from "@/types";

export type { FaqItem };

/** Accessible single-open FAQ accordion. Pages pass their own items. */
export default function FaqAccordion({ faqs }: { faqs: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="max-w-3xl space-y-2">
      {faqs.map((faq, i) => {
        const isOpen = open === i;
        return (
          <div key={i} className="overflow-hidden rounded-lg border border-heading/10 bg-surface">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-4 p-5 text-left"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
            >
              <h3 className="text-sm font-semibold leading-snug text-heading">{faq.q}</h3>
              <svg
                aria-hidden
                className={`h-4 w-4 flex-shrink-0 text-accent transition-transform duration-200 ${
                  isOpen ? "rotate-180" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div
              className="overflow-hidden transition-all duration-200 ease-in-out"
              style={{ maxHeight: isOpen ? "400px" : "0px" }}
            >
              <p className="px-5 pb-5 text-sm leading-relaxed text-muted">{faq.a}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
