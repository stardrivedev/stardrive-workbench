"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { NavItem } from "@/types";
import { siteConfig, quoteConfig } from "@/config/site";
import QuoteButton from "@/components/ui/QuoteButton";

/**
 * Full-width mega-menu panel for one nav group, opened from the header.
 * Layout adapts to the group's depth: children with their own children get
 * a category rail (rail → detail rows); a flat child list renders as
 * description rows next to the group overview.
 */
export default function MegaPanel({
  group,
  top,
  onClose,
}: {
  group: NavItem;
  top: number;
  onClose: () => void;
}) {
  const children = group.children ?? [];
  const hasRail = children.some((c) => c.children?.length);
  const [activeIdx, setActiveIdx] = useState(0);
  const active = children[activeIdx] ?? children[0];

  // Keep Tab / Shift+Tab inside the open panel.
  useEffect(() => {
    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const dialog = document.querySelector<HTMLElement>('[data-mega-panel] [role="dialog"], [role="dialog"]');
      if (!dialog) return;
      const els = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, []);

  const rows = (items: NavItem[]) => (
    <div className="border-t border-heading/10">
      {items.map((item) => (
        <Link
          key={item.href + item.label}
          href={item.href}
          onClick={onClose}
          className="group/row flex items-start gap-8 border-b border-heading/10 py-4 pl-0 transition-all hover:bg-accent/5 hover:pl-2"
        >
          <p className="w-44 flex-shrink-0 text-sm font-semibold text-heading">{item.label}</p>
          {item.description && (
            <p className="hidden text-sm leading-relaxed text-muted sm:block">{item.description}</p>
          )}
          <svg
            aria-hidden
            className="ml-auto mt-0.5 h-3 w-3 flex-shrink-0 text-accent opacity-0 transition-opacity group-hover/row:opacity-100"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      ))}
    </div>
  );

  return (
    <div data-mega-panel>
      {/* Backdrop */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 bg-black/50"
        style={{ top: `${top}px` }}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className="fixed inset-x-0 z-50 hidden overflow-hidden border-t border-heading/10 bg-surface shadow-xl lg:flex"
        style={{ top: `${top}px`, maxHeight: `calc(100vh - ${top}px)` }}
        role="dialog"
        aria-label={`${group.label} menu`}
      >
        {/* Category rail (only for two-level groups) */}
        {hasRail && (
          <div className="flex w-64 flex-shrink-0 flex-col overflow-y-auto border-r border-heading/10 py-4">
            {children.map((cat, i) => {
              const isActive = i === activeIdx;
              return (
                <button
                  key={cat.href + cat.label}
                  type="button"
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => setActiveIdx(i)}
                  aria-current={isActive ? "true" : undefined}
                  className={`flex w-full items-center justify-between border-l-2 px-6 py-3.5 text-left text-sm transition-colors ${
                    isActive
                      ? "border-accent bg-accent/10 font-semibold text-heading"
                      : "border-transparent text-muted hover:text-heading"
                  }`}
                >
                  <span className="truncate">{cat.label}</span>
                  <svg
                    aria-hidden
                    className="h-3 w-3 flex-shrink-0 opacity-30"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              );
            })}
          </div>
        )}

        {/* Detail area */}
        <div className="flex-1 overflow-y-auto px-10 py-8 xl:px-12">
          {hasRail && active ? (
            <>
              <Link
                href={active.href}
                onClick={onClose}
                className="inline-block text-2xl font-bold text-heading hover:underline"
              >
                {active.label} →
              </Link>
              {active.description && (
                <p className="mb-6 mt-2 max-w-2xl text-sm leading-relaxed text-muted">
                  {active.description}
                </p>
              )}
              {active.children?.length ? (
                <div className="mt-4">{rows(active.children)}</div>
              ) : (
                <Link href={active.href} onClick={onClose} className="btn-primary mt-4">
                  View {active.label} →
                </Link>
              )}
            </>
          ) : (
            <>
              <Link
                href={group.href}
                onClick={onClose}
                className="inline-block text-2xl font-bold text-heading hover:underline"
              >
                {group.label} →
              </Link>
              {group.description && (
                <p className="mb-6 mt-2 max-w-2xl text-sm leading-relaxed text-muted">
                  {group.description}
                </p>
              )}
              <div className="mt-4 max-w-3xl">{rows(children)}</div>
            </>
          )}
        </div>

        {/* Sidebar: contact CTAs */}
        <div className="hidden w-64 flex-shrink-0 flex-col gap-3 overflow-y-auto border-l border-heading/10 px-8 py-8 xl:flex">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted">
            Get in touch
          </p>
          {quoteConfig.enabled ? (
            <QuoteButton className="btn-primary justify-center text-xs" onOpen={onClose}>
              Request a quote
            </QuoteButton>
          ) : (
            <Link href="/contact" onClick={onClose} className="btn-primary justify-center text-xs">
              Contact us
            </Link>
          )}
          {siteConfig.phone && (
            <a
              href={`tel:${siteConfig.phone.replace(/[^\d+]/g, "")}`}
              onClick={onClose}
              className="btn-outline justify-center text-xs"
            >
              Call {siteConfig.phone}
            </a>
          )}
          <Link href="/contact" onClick={onClose} className="btn-outline justify-center text-xs">
            Contact page →
          </Link>
        </div>
      </div>
    </div>
  );
}
