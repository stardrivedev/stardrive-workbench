import type { Metadata } from "next";
import { getLocations } from "@/modules/locations/data";
import { LocationCard } from "@/modules/locations/Locations";
import { localBusinessJsonLd } from "@/modules/locations/jsonld";
import PageHeader from "@/components/ui/PageHeader";
import JsonLd from "@/components/seo/JsonLd";

export const metadata: Metadata = { title: "Locations" };
export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  const locations = await getLocations();

  return (
    <>
      <PageHeader
        eyebrow="Locations"
        title="Where to find us"
        subtitle="Address, opening hours and directions."
        slot="hero-locations"
      />
      {locations.map((l) => (
        <JsonLd key={l.id} data={localBusinessJsonLd(l)} />
      ))}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        {locations.length === 0 ? (
          <div className="rounded-md border border-heading/10 bg-surface px-6 py-8 text-sm text-muted">
            Location details are on their way.
          </div>
        ) : (
          <div className="space-y-8">
            {locations.map((l) => (
              <LocationCard key={l.id} location={l} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
