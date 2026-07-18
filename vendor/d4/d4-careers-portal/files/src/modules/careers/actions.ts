"use server";

import { revalidatePath } from "next/cache";
import { assertAuthenticated } from "@/lib/cms/auth";
import { getJobs, saveJobs } from "./data";
import type { Job } from "./types";

export async function getJobsAction(): Promise<{ jobs: Job[]; error?: string }> {
  try {
    await assertAuthenticated();
    return { jobs: await getJobs() };
  } catch (e) {
    return { jobs: [], error: String(e) };
  }
}

export async function saveJobsAction(
  jobs: Job[]
): Promise<{ success: boolean; error?: string }> {
  try {
    await assertAuthenticated();
    await saveJobs(jobs);
    revalidatePath("/careers");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
