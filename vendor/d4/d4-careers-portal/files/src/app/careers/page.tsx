import type { Metadata } from "next";
import { getJobs } from "@/modules/careers/data";
import ApplyForm from "./ApplyForm";

export const metadata: Metadata = { title: "Careers" };
export const dynamic = "force-dynamic";

export default async function CareersPage() {
  const jobs = await getJobs();

  return (
    <section className="mx-auto max-w-4xl px-4 py-20 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Careers</h1>
      <p className="mt-4 max-w-2xl text-muted">
        Open positions are listed below. Apply directly and we&apos;ll get back to you.
      </p>

      {jobs.length === 0 ? (
        <div className="mt-12 rounded-md border border-heading/10 bg-surface px-6 py-8 text-sm text-muted">
          No open positions right now. Check back soon.
        </div>
      ) : (
        <div className="mt-12 space-y-8">
          {jobs.map((job) => (
            <article
              key={job.id}
              className="rounded-lg border border-heading/10 bg-surface p-6 sm:p-8"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-xl font-semibold">{job.title}</h2>
                <div className="flex gap-3 text-xs font-medium uppercase tracking-wide text-accent">
                  <span>{job.type}</span>
                  {job.location && <span className="text-muted">{job.location}</span>}
                </div>
              </div>
              <p className="mt-3 whitespace-pre-line text-sm leading-6">{job.description}</p>
              {job.requirements.length > 0 && (
                <>
                  <h3 className="mt-5 text-sm font-semibold">Requirements</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-body">
                    {job.requirements.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </>
              )}
              <div className="mt-6 border-t border-heading/10 pt-6">
                <ApplyForm jobId={job.id} jobTitle={job.title} />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
