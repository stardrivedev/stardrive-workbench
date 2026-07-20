"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/types";
import { siteAssets } from "@/config/assets.generated";
import { siteConfig, baseNav, tailNav, quoteConfig } from "@/config/site";
import { moduleNav } from "@/config/nav.generated";
import { darkMode } from "@/config/design.generated";
import MegaPanel from "@/components/layout/MegaPanel";
import ThemeToggle from "@/components/ui/ThemeToggle";
import QuoteButton from "@/components/ui/QuoteButton";

const nav: NavItem[] = [...baseNav, ...moduleNav, ...tailNav];

function isDescendantActive(item: NavItem, pathname: string): boolean {
  if (item.href !== "/" && (pathname === item.href || pathname.startsWith(item.href + "/"))) {
    return true;
  }
  return (item.children ?? []).some((c) => isDescendantActive(c, pathname));
}

export default function Header() {
  const pathname = usePathname();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileGroups, setMobileGroups] = useState<Record<string, boolean>>({});
  const headerRef = useRef<HTMLElement>(null);
  const [panelTop, setPanelTop] = useState(64);

  // Close everything on route change.
  useEffect(() => {
    setOpenGroup(null);
    setMobileOpen(false);
  }, [pathname]);

  // Escape closes the open panel / mobile menu.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenGroup(null);
        setMobileOpen(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Track the header's bottom edge so panels sit flush under it (the
  // announcement bar above can scroll away).
  useEffect(() => {
    function measure() {
      if (headerRef.current) setPanelTop(headerRef.current.getBoundingClientRect().bottom);
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
    };
  }, []);

  const groupOpen = nav.find((item) => item.children?.length && item.label === openGroup);

  return (
    <>
      {groupOpen && (
        <MegaPanel group={groupOpen} top={panelTop} onClose={() => setOpenGroup(null)} />
      )}

      <header
        ref={headerRef}
        className="sticky top-0 z-[60] border-b border-heading/10 bg-surface/90 backdrop-blur"
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link
            href="/"
            onClick={() => setOpenGroup(null)}
            className="flex flex-shrink-0 items-center gap-2.5 text-lg font-semibold tracking-tight text-heading"
          >
            {siteAssets.logo?.[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={siteAssets.logo[0]} alt="" className="h-8 w-auto" />
            ) : null}
            {siteConfig.name}
          </Link>

          {/* Desktop nav */}
          <nav className="hidden h-16 flex-1 items-center gap-1 lg:flex" aria-label="Main navigation">
            {nav.map((item) => {
              const active = isDescendantActive(item, pathname) || (item.href === "/" && pathname === "/");
              if (item.children?.length) {
                const isOpen = openGroup === item.label;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => setOpenGroup(isOpen ? null : item.label)}
                    aria-expanded={isOpen}
                    aria-haspopup="dialog"
                    className={`flex h-full items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors ${
                      active
                        ? "border-accent text-heading"
                        : isOpen
                          ? "border-accent/50 text-heading"
                          : "border-transparent text-body hover:text-accent"
                    }`}
                  >
                    {item.label}
                    <svg
                      aria-hidden
                      className={`h-3 w-3 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                );
              }
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpenGroup(null)}
                  className={`flex h-full items-center border-b-2 px-3 text-sm transition-colors hover:text-accent ${
                    pathname === item.href
                      ? "border-accent font-medium text-accent"
                      : "border-transparent text-body"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Desktop right side */}
          <div className="ml-auto hidden flex-shrink-0 items-center gap-3 lg:flex">
            {darkMode && <ThemeToggle />}
            {quoteConfig.enabled ? (
              <QuoteButton
                className="btn-primary px-4 py-2 text-xs"
                onOpen={() => setOpenGroup(null)}
              >
                Request a quote
              </QuoteButton>
            ) : (
              <Link href="/contact" className="btn-primary px-4 py-2 text-xs">
                Contact us
              </Link>
            )}
          </div>

          {/* Mobile: theme toggle + hamburger */}
          <div className="ml-auto flex items-center gap-2 lg:hidden">
            {darkMode && <ThemeToggle />}
            <button
              type="button"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(!mobileOpen)}
              className="flex h-9 w-9 flex-col items-center justify-center gap-1.5"
            >
              <span
                className={`h-0.5 w-5 bg-heading transition-transform ${mobileOpen ? "translate-y-1 rotate-45" : ""}`}
              />
              <span className={`h-0.5 w-5 bg-heading transition-opacity ${mobileOpen ? "opacity-0" : ""}`} />
              <span
                className={`h-0.5 w-5 bg-heading transition-transform ${mobileOpen ? "-translate-y-1.5 -rotate-45" : ""}`}
              />
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <nav
            className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-heading/10 bg-surface px-4 py-3 lg:hidden"
            aria-label="Mobile navigation"
          >
            {nav.map((item) => {
              if (item.children?.length) {
                const expanded = !!mobileGroups[item.label];
                return (
                  <div key={item.label}>
                    <button
                      type="button"
                      onClick={() => setMobileGroups((g) => ({ ...g, [item.label]: !expanded }))}
                      aria-expanded={expanded}
                      className="flex w-full items-center justify-between py-2.5 text-sm font-medium text-heading"
                    >
                      {item.label}
                      <svg
                        aria-hidden
                        className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {expanded && (
                      <div className="space-y-0.5 pb-2 pl-3">
                        <Link
                          href={item.href}
                          onClick={() => setMobileOpen(false)}
                          className="block py-1.5 text-sm font-medium text-body"
                        >
                          All {item.label}
                        </Link>
                        {item.children.map((child) => (
                          <div key={child.href + child.label}>
                            <Link
                              href={child.href}
                              onClick={() => setMobileOpen(false)}
                              className="block py-1.5 text-sm text-muted"
                            >
                              {child.label}
                            </Link>
                            {child.children?.map((sub) => (
                              <Link
                                key={sub.href + sub.label}
                                href={sub.href}
                                onClick={() => setMobileOpen(false)}
                                className="block py-1 pl-3 text-xs text-muted"
                              >
                                ↳ {sub.label}
                              </Link>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`block py-2.5 text-sm ${
                    pathname === item.href ? "font-medium text-accent" : "text-body"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}

            <div className="flex gap-3 pb-4 pt-3">
              {siteConfig.phone && (
                <a
                  href={`tel:${siteConfig.phone.replace(/[^\d+]/g, "")}`}
                  onClick={() => setMobileOpen(false)}
                  className="btn-outline flex-1 justify-center text-xs"
                >
                  Call us
                </a>
              )}
              {quoteConfig.enabled ? (
                <QuoteButton
                  className="btn-primary flex-1 justify-center text-xs"
                  onOpen={() => setMobileOpen(false)}
                >
                  Request a quote
                </QuoteButton>
              ) : (
                <Link
                  href="/contact"
                  onClick={() => setMobileOpen(false)}
                  className="btn-primary flex-1 justify-center text-xs"
                >
                  Contact us
                </Link>
              )}
            </div>
          </nav>
        )}
      </header>
    </>
  );
}
