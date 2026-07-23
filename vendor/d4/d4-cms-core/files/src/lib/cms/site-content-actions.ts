"use server";

import { revalidatePath } from "next/cache";
import { assertAuthenticated } from "@/lib/cms/auth";
import { getLiveContent, saveSiteContent } from "@/lib/site-content";
import type { SiteContent } from "@/config/content.generated";

/** Load the current live copy (baked defaults + any saved edits) for the editor. */
export async function getSiteContentAction(): Promise<{ content: SiteContent | null; error?: string }> {
  try {
    await assertAuthenticated();
    return { content: await getLiveContent() };
  } catch (e) {
    return { content: null, error: String(e) };
  }
}

/** Persist the owner's edits and refresh the pages that render this copy. */
export async function saveSiteContentAction(
  next: SiteContent
): Promise<{ success: boolean; error?: string }> {
  try {
    await assertAuthenticated();
    await saveSiteContent(next);
    revalidatePath("/");
    revalidatePath("/about");
    revalidatePath("/contact");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
