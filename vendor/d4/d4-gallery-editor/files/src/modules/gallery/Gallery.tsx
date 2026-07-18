import { getGallery } from "./data";

/**
 * Server component rendering a responsive image grid for a named gallery.
 * Embed on any page: <Gallery slug="main" />
 */
export default async function Gallery({ slug }: { slug: string }) {
  const images = await getGallery(slug);

  if (images.length === 0) {
    return (
      <div className="rounded-md border border-heading/10 bg-surface px-6 py-8 text-sm text-muted">
        No images in this gallery yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
      {images.map((img) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={img.id}
          src={img.url}
          alt={img.alt}
          loading="lazy"
          className="aspect-[4/3] w-full rounded-md object-cover"
        />
      ))}
    </div>
  );
}
