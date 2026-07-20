import { siteAssets } from "@/config/assets.generated";
import type { Metadata } from "next";
import Gallery from "@/modules/gallery/Gallery";

export const metadata: Metadata = { title: "Gallery" };
export const dynamic = "force-dynamic";

export default function GalleryPage() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Gallery</h1>
      <p className="mt-4 max-w-2xl text-muted">A look at our work.</p>
      <div className="mt-10">
        <Gallery slug="main" />
      </div>
    
      {siteAssets.gallery?.length ? (
        <div className="mx-auto mt-10 grid max-w-6xl gap-4 px-4 sm:grid-cols-2 lg:grid-cols-3 sm:px-6">
          {siteAssets.gallery.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" className="h-64 w-full rounded-xl border border-heading/10 object-cover" />
          ))}
        </div>
      ) : null}
    </section>
  );
}
