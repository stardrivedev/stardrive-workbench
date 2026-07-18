/** Server-only accessors for the articles collection. */
import { readCollection, writeCollection } from "@/lib/cms/data-store";
import type { Article } from "./types";

export async function getArticles(): Promise<Article[]> {
  const articles = await readCollection<Article[]>("articles", []);
  return [...articles].sort((a, b) => b.date.localeCompare(a.date));
}

export async function getArticle(id: string): Promise<Article | undefined> {
  return (await getArticles()).find((a) => a.id === id);
}

export function saveArticles(articles: Article[]): Promise<void> {
  return writeCollection("articles", articles);
}
