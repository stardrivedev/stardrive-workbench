/* eslint-disable @next/next/no-img-element */
import type { MarqueeItem } from "@/types";

export type { MarqueeItem };

const HEIGHTS = { sm: "h-9", md: "h-14", lg: "h-20" } as const;

/**
 * Continuous horizontal logo marquee (client logos, partners, press).
 * Pure CSS animation (globals.css), pauses on hover, static when
 * prefers-reduced-motion. Server component; pages pass items.
 */
export default function LogoMarquee({
  title = "Trusted by",
  items,
}: {
  title?: string;
  items: MarqueeItem[];
}) {
  if (items.length === 0) return null;
  const doubled = [...items, ...items];

  return (
    <section className="border-y border-heading/10 bg-surface py-10">
      <div className="mx-auto mb-5 max-w-6xl px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium uppercase tracking-widest text-muted">{title}</span>
          <div className="h-px flex-1 bg-heading/10" />
        </div>
      </div>

      <div className="d4-marquee">
        <div className="d4-marquee-track">
          {doubled.map((item, i) => (
            <span
              key={i}
              aria-hidden={i >= items.length || undefined}
              className="flex select-none items-center gap-4 px-6"
            >
              <span className="inline-flex flex-col items-center gap-1">
                {item.src ? (
                  <img
                    src={item.src}
                    alt={i < items.length ? item.name : ""}
                    className={`${HEIGHTS[item.size ?? "sm"]} block w-auto object-contain`}
                  />
                ) : (
                  <span className="whitespace-nowrap text-sm font-medium text-body">{item.name}</span>
                )}
                {item.subtitle && (
                  <span className="whitespace-nowrap text-[10px] tracking-wide text-muted">
                    {item.subtitle}
                  </span>
                )}
              </span>
              <span className="text-xs text-heading/20">·</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
