"use server";

import { revalidatePath } from "next/cache";
import { assertAuthenticated } from "@/lib/cms/auth";
import { getLocations, saveLocations } from "./data";
import type { Location } from "./types";

export async function getLocationsAction(): Promise<{ locations: Location[]; error?: string }> {
  try {
    await assertAuthenticated();
    return { locations: await getLocations() };
  } catch (e) {
    return { locations: [], error: String(e) };
  }
}

export async function saveLocationsAction(locations: Location[]): Promise<{ success: boolean; error?: string }> {
  try {
    await assertAuthenticated();
    await saveLocations(locations);
    revalidatePath("/locations");
    revalidatePath("/contact");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
