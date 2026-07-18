"use client";

import Link from "next/link";
import ProductImage from "@/components/ui/ProductImage";
import QuoteButton from "@/components/ui/QuoteButton";

export interface ProductCardItem {
  title: string;
  description?: string;
  image?: string;
  /** Short spec table rows shown at the card's foot. */
  specs?: { label: string; value: string }[];
  partNumber?: string;
  /** CTA destination; external links open in a new tab. */
  href?: string;
  external?: boolean;
  /** Overrides href: CTA opens the quote modal pre-filled for this item. */
  quote?: boolean;
}

/**
 * Product/offering card: image with loading shimmer, spec table, and a
 * link or quote CTA. Content modules (e.g. the catalog) can adapt their
 * items to ProductCardItem and reuse this shell.
 */
export default function ProductCard({ item }: { item: ProductCardItem }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-heading/10 bg-surface">
      <div className="relative flex h-44 items-center justify-center overflow-hidden border-b border-heading/10 bg-base">
        {item.image ? (
          <ProductImage src={item.image} alt={item.title} />
        ) : (
          <div className="flex flex-col items-center gap-2 opacity-30">
            <svg aria-hidden className="h-10 w-10 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span className="text-[10px] uppercase tracking-widest text-muted">Image pending</span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <h3 className="text-sm font-semibold leading-snug text-heading">{item.title}</h3>

        {item.description && (
          <p className="flex-1 text-xs leading-relaxed text-muted">{item.description}</p>
        )}

        {item.specs && item.specs.length > 0 && (
          <div className="mt-auto overflow-hidden rounded-md border border-heading/10">
            <table className="w-full text-xs">
              <tbody>
                {item.specs.map((spec, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-heading/[0.03]" : ""}>
                    <td className="w-1/2 whitespace-nowrap border-r border-heading/10 px-3 py-1.5 text-muted">
                      {spec.label}
                    </td>
                    <td className="px-3 py-1.5 font-medium text-body">{spec.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {item.partNumber && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-muted">P/N:</span>
            <span className="font-medium text-accent">{item.partNumber}</span>
          </div>
        )}

        <div className="pt-1">
          {item.quote ? (
            <QuoteButton
              className="btn-primary w-full justify-center text-xs"
              detail={{
                message: `I'd like a quote for: ${item.title}${
                  item.partNumber ? ` (P/N: ${item.partNumber})` : ""
                }`,
              }}
            >
              Request a quote
            </QuoteButton>
          ) : item.href ? (
            item.external ? (
              <a
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline w-full justify-center text-xs"
              >
                Learn more →
              </a>
            ) : (
              <Link href={item.href} className="btn-outline w-full justify-center text-xs">
                Learn more →
              </Link>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
