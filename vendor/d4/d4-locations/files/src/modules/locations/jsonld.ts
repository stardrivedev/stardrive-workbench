/**
 * LocalBusiness structured data.
 *
 * This is the single highest-value piece of SEO a local business site can
 * carry: it is what lets a search engine show opening hours, a phone number
 * and a map pin instead of a blue link. Every field is omitted when unknown,
 * so a half-filled location produces smaller but still valid markup rather
 * than confident nonsense.
 */
import { siteConfig } from "@/config/site";
import { baseUrl, absoluteUrl, socialImage } from "@/lib/seo";
import { formatAddress } from "./data";
import { SCHEMA_DAYS } from "./types";
import type { Location } from "./types";

export function localBusinessJsonLd(loc: Location): Record<string, unknown> {
  const a = loc.address;
  const image = socialImage();

  const openingHours = loc.hours
    .filter((h) => !h.closed && h.opens && h.closes && SCHEMA_DAYS[h.day])
    .map((h) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: SCHEMA_DAYS[h.day],
      opens: h.opens,
      closes: h.closes,
    }));

  const hasAddress = Boolean(a.street || a.city || a.postalCode);

  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": `${baseUrl()}/locations#${loc.id}`,
    name: loc.name || siteConfig.name,
    url: `${baseUrl()}/locations`,
    ...(image ? { image: absoluteUrl(image) } : {}),
    ...(loc.phone ? { telephone: loc.phone } : {}),
    ...(loc.email ? { email: loc.email } : {}),
    ...(hasAddress
      ? {
          address: {
            "@type": "PostalAddress",
            ...(a.street ? { streetAddress: a.street } : {}),
            ...(a.city ? { addressLocality: a.city } : {}),
            ...(a.region ? { addressRegion: a.region } : {}),
            ...(a.postalCode ? { postalCode: a.postalCode } : {}),
            ...(a.country ? { addressCountry: a.country } : {}),
          },
        }
      : {}),
    ...(loc.lat != null && loc.lng != null
      ? { geo: { "@type": "GeoCoordinates", latitude: loc.lat, longitude: loc.lng } }
      : {}),
    ...(openingHours.length ? { openingHoursSpecification: openingHours } : {}),
    ...(hasAddress ? { hasMap: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatAddress(a))}` } : {}),
  };
}
