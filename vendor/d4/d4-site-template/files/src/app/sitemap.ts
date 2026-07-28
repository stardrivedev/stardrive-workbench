import type { MetadataRoute } from "next";
import { baseNav, tailNav } from "@/config/site";
import { moduleNav } from "@/config/nav.generated";
import { baseUrl } from "@/lib/seo";

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
