"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { announcement } from "@/config/site";

const STORAGE_KEY = "d4-announcement-dismissed";

/**
 * Optional site-wide announcement above the header. Config-gated: renders
 * nothing when the build config sets no announcement. Dismissal lasts for
 * the browser session.
 */
export default function AnnouncementBar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!announcement) return;
    try {
      if (!sessionStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  if (!announcement || !visible) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* session storage unavailable */
    }
    setVisible(false);
  }

  const content = (
    <span className="inline-flex items-center gap-2">
      <span>{announcement.text}</span>
      {announcement.href && (
        <span className="font-bold">{announcement.linkLabel ?? "Learn more"} →</span>
      )}
    </span>
  );

  return (
    <div className="relative flex items-center justify-center bg-accent px-10 py-2.5 text-xs font-medium text-on-accent">
      {announcement.href ? (
        <Link href={announcement.href} className="transition-opacity hover:opacity-75">
          {content}
        </Link>
      ) : (
        content
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 transition-opacity hover:opacity-60"
      >
        <svg aria-hidden className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
