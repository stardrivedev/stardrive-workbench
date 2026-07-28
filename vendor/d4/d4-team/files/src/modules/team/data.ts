/**
 * Server-only accessors for the team collection.
 *
 * Order is the stored array order, not an alphabetical sort or a numeric
 * `order` field. Seniority is the usual intent and only the owner knows it,
 * so the editor moves people up and down and the site renders what it is told.
 */
import { readCollection, writeCollection } from "@/lib/cms/data-store";
import { seedTeam } from "@/config/team.generated";
import type { TeamMember } from "./types";

export function getTeam(): Promise<TeamMember[]> {
  return readCollection<TeamMember[]>("team", seedTeam);
}

export function saveTeam(members: TeamMember[]): Promise<void> {
  return writeCollection("team", members);
}
