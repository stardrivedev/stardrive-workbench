import { siteAssets } from "@/config/assets.generated";
import type { Metadata } from "next";
import Gallery from "@/modules/gallery/Gallery";
import PageHeader from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Gallery" };
export const dynamic = "force-dynamic";

export default function GalleryPage() {
  return (
    <>
      <PageHeader
        eyebrow="Gallery"
        title="Gallery"
        subtitle="A look at our work."
        slot="hero-gallery"
      />
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <Gallery slug="main" />

        {siteAssets.gallery?.length ? (
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {siteAssets.gallery.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt="" className="h-64 w-full rounded-xl border border-heading/10 object-cover" />
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}
