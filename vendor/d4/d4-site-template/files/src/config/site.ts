import type { Announcement, FaqItem, LogoWall, NavItem, QuoteConfig, SocialLink } from "@/types";

/**
 * Site identity. d4-site-builder rewrites the values in this file from the
 * build config when assembling a client site.
 */
export const siteConfig = {
  name: "New Site",
  tagline: "A clear, direct statement of what this business does.",
  description:
    "Replace this with two or three sentences about the business: who it serves, what it delivers, and why clients choose it.",
  contactEmail: "hello@example.com",
  phone: "",
  address: "",
};

/**
 * Base navigation. Module nav entries are appended after these. Items with
 * children render as mega-menu groups; flat items as plain links.
 */
export const baseNav: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about" },
];

/** Nav entries pinned to the end (after module entries). */
export const tailNav: NavItem[] = [{ label: "Contact", href: "/contact" }];

/** Optional announcement bar above the header; null = hidden. */
export const announcement: Announcement | null = null;

/** Quote-request modal; when disabled, quote CTAs link to /contact instead. */
export const quoteConfig: QuoteConfig = { enabled: true, topics: [] };

/** Social profiles shown in the footer; empty = hidden. */
export const socialLinks: SocialLink[] = [];

/** FAQ entries for the home page; empty = section hidden. */
export const faq: FaqItem[] = [];

/** Client/partner logo strip on the home page; empty items = hidden. */
export const logoWall: LogoWall = { items: [] };
