import Link from "next/link";
import { notFound } from "next/navigation";
import { getArticle } from "@/modules/insights/data";
import { renderMarkdown } from "@/lib/cms/markdown";

export const dynamic = "force-dynamic";

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const article = await getArticle(id);
  if (!article) notFound();

  return (
    <article className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
      <Link href="/insights" className="text-sm text-accent hover:underline">
        Back to insights
      </Link>
      <p className="mt-6 text-xs text-muted">
        {article.date}
        {article.author ? ` · ${article.author}` : ""}
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
        {article.title}
      </h1>
      {article.subtitle && <p className="mt-3 text-lg text-muted">{article.subtitle}</p>}
      {article.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={article.image}
          alt=""
          className="mt-8 w-full rounded-lg object-cover"
        />
      )}
      <div
        className="article-body mt-10 space-y-4 leading-7 [&_a]:text-accent [&_a]:underline [&_code]:rounded [&_code]:bg-heading/5 [&_code]:px-1 [&_code]:text-sm [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(article.body) }}
      />
      {article.tags.length > 0 && (
        <div className="mt-10 flex flex-wrap gap-1.5 border-t border-heading/10 pt-6">
          {article.tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
