import { siteAssets } from "@/config/assets.generated";

/**
 * Consistent page header used on every non-home page (about, contact, and each
 * feature page). By default it renders the designed light header (accent eyebrow
 * + title + muted subtitle). If the site has an uploaded background image for
 * this page's hero slot (e.g. "hero-about"), that image sits BEHIND the text,
 * kept legible with a scrim. No image is ever generated; a blank slot keeps the
 * designed header.
 */
export default function PageHeader({
  title,
  subtitle,
  eyebrow,
  slot,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  slot?: string;
}) {
  const bg = slot ? siteAssets[slot]?.[0] : undefined;

  if (bg) {
    return (
      <section className="relative overflow-hidden border-b border-heading/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={bg} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/55 to-black/35" />
        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          {eyebrow ? (
            <p className="flex items-center gap-3 text-sm font-medium uppercase tracking-widest text-white/80">
              <span aria-hidden className="h-px w-8 bg-white/70" />
              {eyebrow}
            </p>
          ) : null}
          <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-white drop-shadow sm:text-5xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-4 max-w-2xl text-lg text-white/90 drop-shadow">{subtitle}</p>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="border-b border-heading/10">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        {eyebrow ? (
          <p className="flex items-center gap-3 text-sm font-medium uppercase tracking-widest text-accent">
            <span aria-hidden className="h-px w-8 bg-accent" />
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
          {title}
        </h1>
        {subtitle ? <p className="mt-4 max-w-2xl text-lg text-muted">{subtitle}</p> : null}
      </div>
    </section>
  );
}
