"use client";

export const QUOTE_MODAL_EVENT = "d4:open-quote-modal";

export interface QuoteModalDetail {
  topic?: string;
  message?: string;
}

/** Opens the site-wide quote modal, optionally pre-filling fields. */
export default function QuoteButton({
  className,
  children,
  detail,
  onOpen,
}: {
  className?: string;
  children: React.ReactNode;
  detail?: QuoteModalDetail;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        onOpen?.();
        window.dispatchEvent(
          new CustomEvent<QuoteModalDetail>(QUOTE_MODAL_EVENT, detail ? { detail } : undefined)
        );
      }}
    >
      {children}
    </button>
  );
}
