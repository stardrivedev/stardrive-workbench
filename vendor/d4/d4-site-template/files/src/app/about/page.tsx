import { siteAssets } from "@/config/assets.generated";
import type { Metadata } from "next";
import Link from "next/link";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
      <p className="flex items-center gap-3 text-sm font-medium uppercase tracking-widest text-accent">
        <span aria-hidden className="h-px w-8 bg-accent" />
        About us
      </p>
      <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-5xl">
        About {siteConfig.name}
      </h1>
      <div className="mt-10 space-y-6 leading-8">
        <p className="text-lg text-heading/90">{siteConfig.description}</p>
        <p>
          Replace this section with the story of the business: how it started, what it
          stands for, and the people behind it. Keep it in the client&apos;s own words
          and grounded in facts they supplied.
        </p>
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
  );
}
