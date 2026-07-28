import { getTeam } from "./data";
import type { TeamMember } from "./types";

/** Initials stand in when there is no photo, so the grid never breaks into
 *  a row of broken-image icons on a half-finished site. */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function TeamCard({ member }: { member: TeamMember }) {
  return (
    <article className="flex h-full flex-col rounded-lg border border-heading/10 bg-surface p-6">
      {member.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={member.photo} alt="" className="h-24 w-24 rounded-full object-cover" />
      ) : (
        <p aria-hidden className="flex h-24 w-24 items-center justify-center rounded-full bg-accent/10 text-xl font-semibold text-accent">
          {initialsOf(member.name)}
        </p>
      )}
      <h3 className="mt-5 text-lg font-semibold">{member.name}</h3>
      <p className="text-sm font-medium text-accent">{member.role}</p>
      {member.bio ? <p className="mt-3 flex-1 whitespace-pre-line text-sm leading-6 text-body">{member.bio}</p> : null}

      {member.email || member.phone || member.links?.length ? (
        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 border-t border-heading/10 pt-4 text-sm">
          {member.email ? (
            <a href={`mailto:${member.email}`} className="text-accent hover:underline">Email</a>
          ) : null}
          {member.phone ? (
            <a href={`tel:${member.phone.replace(/[^\d+]/g, "")}`} className="text-accent hover:underline">{member.phone}</a>
          ) : null}
          {(member.links ?? []).map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              {l.label}
            </a>
          ))}
        </div>
      ) : null}
    </article>
  );
}

/**
 * Embeddable grid, for the about page or anywhere else:
 *   <Team limit={4} title="Meet the team" />
 * Renders nothing when nobody has been added yet.
 */
export default async function Team({
  limit,
  title = "Meet the team",
}: {
  limit?: number;
  title?: string;
}) {
  const all = await getTeam();
  const members = typeof limit === "number" ? all.slice(0, limit) : all;
  if (!members.length) return null;

  return (
    <section className="border-t border-heading/10">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => (
            <TeamCard key={m.id} member={m} />
          ))}
        </div>
      </div>
    </section>
  );
}
