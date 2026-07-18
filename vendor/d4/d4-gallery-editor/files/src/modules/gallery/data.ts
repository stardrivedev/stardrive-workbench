/** Server-only accessors for the galleries collection. */
import { readCollection, writeCollection } from "@/lib/cms/data-store";
import type { Galleries, GalleryImage } from "./types";

export function getGalleries(): Promise<Galleries> {
  return readCollection<Galleries>("galleries", {});
}

export async function getGallery(slug: string): Promise<GalleryImage[]> {
  return (await getGalleries())[slug] ?? [];
}

export async function saveGallery(slug: string, images: GalleryImage[]): Promise<void> {
  const all = await getGalleries();
  all[slug] = images;
  await writeCollection("galleries", all);
}

export async function deleteGallery(slug: string): Promise<void> {
  const all = await getGalleries();
  delete all[slug];
  await writeCollection("galleries", all);
}
