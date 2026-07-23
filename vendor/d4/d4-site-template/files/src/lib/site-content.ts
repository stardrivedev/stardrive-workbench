/**
 * The page-copy accessor. Pages read their body text through `getLiveContent()`
 * rather than importing `siteContent` directly.
 *
 * This base version simply returns the copy baked at assembly
 * (`content.generated.ts`). When the CMS (d4-cms-core) is selected, its build
 * OVERRIDES this file with a version that reads the owner's /admin edits from
 * the database and merges them over the baked copy — so the same import becomes
 * live-editable, and pages pick up edits without a rebuild. Because this base
 * version touches no request-time data, non-CMS pages stay statically rendered.
 */
import { siteContent, type SiteContent } from "@/config/content.generated";

export async function getLiveContent(): Promise<SiteContent> {
  return siteContent;
}
