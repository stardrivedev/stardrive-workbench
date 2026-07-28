/**
 * Search and social metadata helpers.
 *
 * Two jobs that every client site needs and neither of which the owner will
 * ever ask for by name: a link that previews properly when it is pasted into
 * WhatsApp or LinkedIn, and enough structured data for a search engine to
 * understand that this is a business rather than a page of words.
 *
 * The public origin comes from NEXT_PUBLIC_SITE_URL, which is what Stardrive
 * writes when a custom domain is attached. Without it we fall back to the
 * platform's own URL, and finally to localhost, so the site is correct in dev,
 * correct on a preview deployment, and correct on the real domain, with no
 * per-environment editing.
 */
import { siteConfig, socialLinks } from "@/config/site";
import { siteAssets } from "@/config/assets.generated";

/** The site's public origin, never with a trailing slash. */
export function baseUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/** An absolute URL for a site-relative path. */
export function absoluteUrl(pathname = "/"): string {
  const p = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${baseUrl()}${p === "/" ? "" : p}`;
}

/**
 * The image a shared link should preview with. There is no generated
 * placeholder here on purpose: an uploaded photo or nothing, because a
 * made-up preview image is worse than a plain link.
 */
export function socialImage(): string | undefined {
  return siteAssets.hero?.[0] ?? siteAssets.about?.[0] ?? siteAssets.logo?.[0];
}

/** Icons declared from the uploaded favicon slot, when there is one. */
export function iconMetadata() {
  const icon = siteAssets.favicon?.[0];
  return icon ? { icon: [{ url: icon }], apple: [{ url: icon }] } : undefined;
}

/**
 * The business itself. `sameAs` carries the owner's social profiles, which is
 * how a search engine ties this site to those accounts.
 */
export function organizationJsonLd(): Record<string, unknown> {
  const image = socialImage();
  const profiles = socialLinks.map((s) => s.href).filter(Boolean);
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: siteConfig.name,
    url: baseUrl(),
    ...(siteConfig.description ? { description: siteConfig.description } : {}),
    ...(image ? { logo: absoluteUrl(image), image: absoluteUrl(image) } : {}),
    ...(siteConfig.contactEmail ? { email: siteConfig.contactEmail } : {}),
    ...(siteConfig.phone ? { telephone: siteConfig.phone } : {}),
    ...(profiles.length ? { sameAs: profiles } : {}),
  };
}

/** The site as a thing that can be searched and linked. */
export function webSiteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteConfig.name,
    url: baseUrl(),
  };
}
