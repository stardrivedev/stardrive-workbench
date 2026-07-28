import { NextResponse } from "next/server";
import { getAvailability, getBookings, getServices, slotsFor } from "@/modules/booking/data";

export const dynamic = "force-dynamic";

/** Free slots for one service on one date. Read against the live diary every
 *  time, so a slot taken a second ago is already gone from the picker. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const serviceId = String(url.searchParams.get("serviceId") ?? "");
  const date = String(url.searchParams.get("date") ?? "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "A date is required, as YYYY-MM-DD." }, { status: 400 });
  }

  const [services, settings, bookings] = await Promise.all([getServices(), getAvailability(), getBookings()]);
  const service = services.find((s) => s.id === serviceId);
  if (!service) return NextResponse.json({ error: "Unknown service." }, { status: 404 });

  return NextResponse.json({
    timezone: settings.timezone,
    slots: slotsFor(service, settings, bookings, date),
  });
}
