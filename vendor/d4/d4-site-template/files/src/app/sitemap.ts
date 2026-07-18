import type { MetadataRoute } from "next";
import { baseNav, tailNav } from "@/config/site";
import { moduleNav } from "@/config/nav.generated";

function baseUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = baseUrl();
  const hrefs = [...baseNav, ...moduleNav, ...tailNav].map((n) => n.href);
  const unique = [...new Set(hrefs)];
  return unique.map((href) => ({
    url: `${base}${href === "/" ? "" : href}`,
    changeFrequency: "monthly",
    priority: href === "/" ? 1 : 0.7,
  }));
}
