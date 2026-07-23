/**
 * CMS override of the page-copy accessor (installed by d4-cms-core, replacing
 * the base template's static version). Reads the owner's edits saved from the
 * /admin "Pages" panel and merges them over the copy baked at assembly, so the
 * public pages reflect edits without a rebuild.
 *
 * `noStore()` opts the calling pages into dynamic rendering so an edit shows on
 * the next request. `readCollection` swallows errors and returns its fallback,
 * so an empty or unreachable database renders the baked copy — pages never
 * crash for lack of a database.
 */
import { unstable_noStore as noStore } from "next/cache";
import { readCollection, writeCollection } from "@/lib/cms/data-store";
import { siteContent, type SiteContent } from "@/config/content.generated";

const COLLECTION = "content";

/** Merge saved edits over the baked copy. The Pages panel saves a full content
 *  object, but partials are tolerated: known object sections merge one level in;
 *  arrays and scalars replace wholesale when present. */
function merge(base: SiteContent, over: Partial<SiteContent>): SiteContent {
  return {
    ...base,
    ...over,
    home: { ...base.home, ...(over.home || {}) },
    about: { ...base.about, ...(over.about || {}) },
    contact: { ...base.contact, ...(over.contact || {}) },
  };
}

export async function getLiveContent(): Promise<SiteContent> {
  noStore();
  const over = await readCollection<Partial<SiteContent>>(COLLECTION, {});
  return merge(siteContent, over);
}

export async function saveSiteContent(next: SiteContent): Promise<void> {
  await writeCollection(COLLECTION, next);
}
