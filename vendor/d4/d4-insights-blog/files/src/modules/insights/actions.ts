"use server";

import { revalidatePath } from "next/cache";
import { assertAuthenticated } from "@/lib/cms/auth";
import { getArticles, saveArticles } from "./data";
import type { Article } from "./types";

export async function getArticlesAction(): Promise<{ articles: Article[]; error?: string }> {
  try {
    await assertAuthenticated();
    return { articles: await getArticles() };
  } catch (e) {
    return { articles: [], error: String(e) };
  }
}

export async function saveArticlesAction(
  articles: Article[]
): Promise<{ success: boolean; error?: string }> {
  try {
    await assertAuthenticated();
    await saveArticles(articles);
    revalidatePath("/insights");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
