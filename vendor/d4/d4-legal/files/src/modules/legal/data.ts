/** Server-only accessors for legal pages. */
import { readCollection, writeCollection } from "@/lib/cms/data-store";
import { seedLegalPages } from "@/config/legal.generated";
import type { LegalPage } from "./types";

export function getLegalPages(): Promise<LegalPage[]> {
  return readCollection<LegalPage[]>("legal-pages", seedLegalPages);
}

export function saveLegalPages(pages: LegalPage[]): Promise<void> {
  return writeCollection("legal-pages", pages);
}

/** Only pages the owner has actually approved are public. */
export async function getPublishedPages(): Promise<LegalPage[]> {
  return (await getLegalPages()).filter((p) => p.reviewed);
}

export async function getPublishedPage(slug: string): Promise<LegalPage | null> {
  const pages = await getPublishedPages();
  return pages.find((p) => p.slug === slug) ?? null;
}
