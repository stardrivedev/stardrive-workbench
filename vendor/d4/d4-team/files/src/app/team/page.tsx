import type { Metadata } from "next";
import { getTeam } from "@/modules/team/data";
import { TeamCard } from "@/modules/team/Team";
import PageHeader from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Team" };
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const members = await getTeam();

  return (
    <>
      <PageHeader
        eyebrow="Team"
        title="Meet the team"
        subtitle="The people you will be working with."
        slot="hero-team"
      />
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        {members.length === 0 ? (
          <div className="rounded-md border border-heading/10 bg-surface px-6 py-8 text-sm text-muted">
            Team profiles are on their way.
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((m) => (
              <TeamCard key={m.id} member={m} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
