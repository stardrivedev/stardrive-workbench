import type { Metadata } from "next";
import Link from "next/link";
import { getArticles } from "@/modules/insights/data";

export const metadata: Metadata = { title: "Insights" };
export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const articles = await getArticles();

  return (
    <section className="mx-auto max-w-4xl px-4 py-20 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Insights</h1>
      <p className="mt-4 max-w-2xl text-muted">
        Articles, updates, and news.
      </p>

      {articles.length === 0 ? (
        <div className="mt-12 rounded-md border border-heading/10 bg-surface px-6 py-8 text-sm text-muted">
          Nothing published yet. Check back soon.
        </div>
      ) : (
        <div className="mt-12 space-y-6">
          {articles.map((a) => (
            <Link
              key={a.id}
              href={`/insights/${a.id}`}
              className="block rounded-lg border border-heading/10 bg-surface p-6 transition-colors hover:border-accent/40 sm:flex sm:gap-6"
            >
              {a.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.image}
                  alt=""
                  className="mb-4 h-36 w-full rounded-md object-cover sm:mb-0 sm:w-48 sm:shrink-0"
                />
              )}
              <div>
                <p className="text-xs text-muted">
                  {a.date}
                  {a.author ? ` · ${a.author}` : ""}
                </p>
                <h2 className="mt-1 text-lg font-semibold">{a.title}</h2>
                {a.subtitle && <p className="mt-1 text-sm text-muted">{a.subtitle}</p>}
                {a.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {a.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
