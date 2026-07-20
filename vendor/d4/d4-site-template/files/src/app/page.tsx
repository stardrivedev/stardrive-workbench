import Link from "next/link";
import { siteConfig, faq, logoWall } from "@/config/site";
import { siteAssets } from "@/config/assets.generated";
import FaqAccordion from "@/components/ui/FaqAccordion";
import LogoMarquee from "@/components/ui/LogoMarquee";

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 right-[-12%] h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
          <div className="absolute -bottom-40 left-[-8%] h-80 w-80 rounded-full bg-accent/5 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-6xl px-4 py-28 sm:px-6 sm:py-36">
          <p className="flex items-center gap-3 text-sm font-medium uppercase tracking-widest text-accent">
            <span aria-hidden className="h-px w-8 bg-accent" />
            {siteConfig.name}
          </p>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            {siteConfig.tagline}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted">{siteConfig.description}</p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-3 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong"
            >
              Get in touch
              <svg
                aria-hidden
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 8h11M9 3.5 13.5 8 9 12.5" />
              </svg>
            </Link>
            <Link
              href="/about"
              className="rounded-md border border-heading/15 px-6 py-3 text-sm font-medium text-heading transition-colors hover:border-accent hover:text-accent"
            >
              Learn more
            </Link>
          </div>
        </div>
      </section>

      {siteAssets.hero?.[0] && (
        <section aria-label="Featured imagery" className="border-t border-heading/10">
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={siteAssets.hero[0]}
              alt=""
              className="max-h-[420px] w-full rounded-2xl border border-heading/10 object-cover"
            />
          </div>
        </section>
      )}

      {logoWall.items.length > 0 && (
        <LogoMarquee title={logoWall.title} items={logoWall.items} />
      )}

      <section className="border-t border-heading/10 bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              {
                title: "What we do",
                body: "Summarize the core service or product in plain language a first-time visitor understands immediately.",
              },
              {
                title: "Who we serve",
                body: "Name the customers this business exists for and the problem it takes off their plate.",
              },
              {
                title: "Why it works",
                body: "State the proof: years in business, results delivered, or the approach that sets this business apart.",
              },
            ].map((card) => (
              <div
                key={card.title}
                className="rounded-xl border border-heading/10 bg-base p-7 transition-colors hover:border-accent/40"
              >
                <span aria-hidden className="block h-1.5 w-10 rounded-full bg-accent/80" />
                <h2 className="mt-5 text-lg font-semibold">{card.title}</h2>
                <p className="mt-2.5 text-sm leading-6 text-muted">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {faq.length > 0 && (
        <section className="border-t border-heading/10">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <p className="flex items-center gap-3 text-sm font-medium uppercase tracking-widest text-accent">
              <span aria-hidden className="h-px w-8 bg-accent" />
              Common questions
            </p>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
              Answers before you ask
            </h2>
            <div className="mt-8">
              <FaqAccordion faqs={faq} />
            </div>
          </div>
        </section>
      )}

      <section className="border-t border-heading/10 bg-accent/5">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Tell us about your project
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted">
            Questions, quotes, or early ideas are all welcome. Send a message and
            we&apos;ll get back to you.
          </p>
          <Link
            href="/contact"
            className="mt-8 inline-flex items-center gap-2 rounded-md bg-accent px-6 py-3 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong"
          >
            Contact {siteConfig.name}
          </Link>
        </div>
      </section>
    </>
  );
}
