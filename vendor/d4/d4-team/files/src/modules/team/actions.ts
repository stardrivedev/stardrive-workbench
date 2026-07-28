"use server";

import { revalidatePath } from "next/cache";
import { assertAuthenticated } from "@/lib/cms/auth";
import { getTeam, saveTeam } from "./data";
import type { TeamMember } from "./types";

export async function getTeamAction(): Promise<{ members: TeamMember[]; error?: string }> {
  try {
    await assertAuthenticated();
    return { members: await getTeam() };
  } catch (e) {
    return { members: [], error: String(e) };
  }
}

export async function saveTeamAction(members: TeamMember[]): Promise<{ success: boolean; error?: string }> {
  try {
    await assertAuthenticated();
    await saveTeam(members);
    revalidatePath("/team");
    revalidatePath("/about");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
