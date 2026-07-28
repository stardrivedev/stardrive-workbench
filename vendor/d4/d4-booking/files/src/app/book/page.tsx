import type { Metadata } from "next";
import { bookableDates, getAvailability, getServices } from "@/modules/booking/data";
import PageHeader from "@/components/ui/PageHeader";
import BookingFlow from "./BookingFlow";

export const metadata: Metadata = { title: "Book" };
export const dynamic = "force-dynamic";

export default async function BookPage() {
  const [services, settings] = await Promise.all([getServices(), getAvailability()]);
  const bookable = services.filter((s) => !s.hidden);

  return (
    <>
      <PageHeader
        eyebrow="Booking"
        title="Book an appointment"
        subtitle="Pick what you need and a time that suits you."
        slot="hero-book"
      />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <BookingFlow
          services={bookable}
          dates={bookableDates(settings)}
          timezone={settings.timezone}
        />
      </section>
    </>
  );
}
