import { siteAssets } from "@/config/assets.generated";
import { getLiveContent } from "@/lib/site-content";
import type { Metadata } from "next";
import Link from "next/link";
import { siteConfig } from "@/config/site";
import PageHeader from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "About" };

export default async function AboutPage() {
  const siteContent = await getLiveContent();
  return (
    <>
      <PageHeader eyebrow="About us" title={`About ${siteConfig.name}`} slot="hero-about" />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <div className="space-y-6 leading-8">
        {siteContent.about.paragraphs.length > 0 ? (
          siteContent.about.paragraphs.map((para, i) => (
            <p key={i} className={i === 0 ? "text-lg text-heading/90" : undefined}>
              {para}
            </p>
          ))
        ) : (
          <p className="text-lg text-heading/90">{siteConfig.description}</p>
        )}
        {siteContent.about.mission && (
          <p className="text-lg font-medium text-heading">{siteContent.about.mission}</p>
        )}
      </div>

      {siteAssets.about?.length ? (
        <div className="mt-16 grid gap-4 sm:grid-cols-2">
          {siteAssets.about.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" className="max-h-80 w-full rounded-xl border border-heading/10 object-cover" />
          ))}
        </div>
      ) : null}
      {siteAssets.team?.length ? (
        <div className="mt-10 flex flex-wrap gap-4">
          {siteAssets.team.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" className="h-28 w-28 rounded-full border border-heading/10 object-cover" />
          ))}
        </div>
      ) : null}

      <div className="mt-16 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-heading/10 bg-surface p-7">
        <p className="font-medium text-heading">Want to work with us?</p>
        <Link
          href="/contact"
          className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong"
        >
          Get in touch
        </Link>
      </div>
      </section>
    </>
  );
}
