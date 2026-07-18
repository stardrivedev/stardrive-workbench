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
    </section>
  );
}
