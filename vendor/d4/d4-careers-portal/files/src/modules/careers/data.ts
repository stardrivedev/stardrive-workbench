/** Server-only accessors for careers collections. */
import { readCollection, writeCollection } from "@/lib/cms/data-store";
import type { Job, Application } from "./types";

export function getJobs(): Promise<Job[]> {
  return readCollection<Job[]>("jobs", []);
}

export function saveJobs(jobs: Job[]): Promise<void> {
  return writeCollection("jobs", jobs);
}

export async function addApplication(app: Application): Promise<void> {
  const existing = await readCollection<Application[]>("applications", []);
  existing.push(app);
  await writeCollection("applications", existing);
}
