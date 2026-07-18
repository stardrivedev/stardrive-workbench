"use server";

import { revalidatePath } from "next/cache";
import { assertAuthenticated } from "@/lib/cms/auth";
import { getGalleries, saveGallery, deleteGallery } from "./data";
import type { Galleries, GalleryImage } from "./types";

export async function getGalleriesAction(): Promise<{ galleries: Galleries; error?: string }> {
  try {
    await assertAuthenticated();
    return { galleries: await getGalleries() };
  } catch (e) {
    return { galleries: {}, error: String(e) };
  }
}

export async function saveGalleryAction(
  slug: string,
  images: GalleryImage[]
): Promise<{ success: boolean; error?: string }> {
  try {
    await assertAuthenticated();
    await saveGallery(slug, images);
    revalidatePath("/gallery");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function deleteGalleryAction(
  slug: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await assertAuthenticated();
    await deleteGallery(slug);
    revalidatePath("/gallery");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
