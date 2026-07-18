"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Activates the scroll-reveal part of the site's motion signature
 * (data-motion on <html>). Progressive enhancement only: the hiding class
 * is added here at runtime, so without JS (or with prefers-reduced-motion)
 * every element stays visible and static.
 */
const REVEAL_MODES = new Set([
  "reveal",
  "reveal-fast",
  "reveal-slow",
  "playful-bounce",
  "ambient-drift",
]);

export default function MotionLayer() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname.startsWith("/admin")) return;
    const mode = document.documentElement.getAttribute("data-motion") ?? "still";
    if (!REVEAL_MODES.has(mode)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Top-level blocks in each section, plus the children of plain div
    // wrappers (card grids, button rows) so groups stagger item by item.
    const targets = document.querySelectorAll<HTMLElement>(
      "main section > *:not(div), main section > div > *"
    );
    const io = new IntersectionObserver(
      (entries) => {
        let batch = 0;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          el.style.transitionDelay = `${Math.min(batch * 60, 360)}ms`;
          el.classList.add("d4-in");
          io.unobserve(el);
          batch++;
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -8% 0px" }
    );
    for (const el of targets) {
      el.classList.add("d4-reveal");
      io.observe(el);
    }
    return () => {
      io.disconnect();
      for (const el of targets) {
        el.classList.remove("d4-reveal", "d4-in");
        el.style.transitionDelay = "";
      }
    };
  }, [pathname]);

  return null;
}
