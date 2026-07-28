"use server";

import { revalidatePath } from "next/cache";
import { assertAuthenticated } from "@/lib/cms/auth";
import { getLegalPages, saveLegalPages } from "./data";
import type { LegalPage } from "./types";

export async function getLegalPagesAction(): Promise<{ pages: LegalPage[]; error?: string }> {
  try {
    await assertAuthenticated();
    return { pages: await getLegalPages() };
  } catch (e) {
    return { pages: [], error: String(e) };
  }
}

export async function saveLegalPagesAction(pages: LegalPage[]): Promise<{ success: boolean; error?: string }> {
  try {
    await assertAuthenticated();
    // Approving is what stamps the date, so a visitor reading "last updated"
    // is seeing when a person last checked it, not when a typo was fixed.
    const stamped = pages.map((p) =>
      p.reviewed && !p.updatedAt ? { ...p, updatedAt: new Date().toISOString().slice(0, 10) } : p
    );
    await saveLegalPages(stamped);
    revalidatePath("/legal");
    for (const p of stamped) revalidatePath(`/legal/${p.slug}`);
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
