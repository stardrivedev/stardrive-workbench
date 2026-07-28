import { NextResponse } from "next/server";
import {
  conflictsWith,
  getAvailability,
  getBookings,
  getServices,
  saveBookings,
  slotsFor,
} from "@/modules/booking/data";
import { friendlyDate, friendlyTime, partsInZone } from "@/modules/booking/time";
import type { Booking } from "@/modules/booking/types";

export const dynamic = "force-dynamic";

/**
 * Two bookings for one slot is the failure this module exists to prevent, and
 * the store writes a whole collection at a time, so a plain read-check-write
 * leaves a window where two requests both see a free slot.
 *
 * So the write is followed by a re-read. If a rival for the same slot appeared,
 * exactly one of them is the winner by a rule both requests compute the same
 * way (earliest createdAt, ties broken by id), and the loser withdraws itself
 * and reports the clash. The customer gets an honest "just taken, pick
 * another" instead of turning up to a double-booked chair.
 */
function loses(mine: Booking, rival: Booking): boolean {
  if (mine.createdAt !== rival.createdAt) return mine.createdAt > rival.createdAt;
  return mine.id > rival.id;
}

const overlaps = (a: Booking, b: Booking) =>
  Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const serviceId = String(body.serviceId ?? "").trim().slice(0, 100);
  const startIso = String(body.start ?? "").trim();
  const name = String(body.name ?? "").trim().slice(0, 200);
  const email = String(body.email ?? "").trim().slice(0, 200);
  const phone = String(body.phone ?? "").trim().slice(0, 60);
  const notes = String(body.notes ?? "").trim().slice(0, 2000);

  if (!serviceId || !startIso || !name || !email) {
    return NextResponse.json({ error: "Service, time, name and email are all required." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "That email address does not look right." }, { status: 400 });
  }

  const [services, settings] = await Promise.all([getServices(), getAvailability()]);
  const service = services.find((s) => s.id === serviceId);
  if (!service) return NextResponse.json({ error: "Unknown service." }, { status: 404 });

  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: "That time is not valid." }, { status: 400 });
  }

  // The slot must be one this diary actually offers. Without this check a
  // crafted request could book 3am on a closed Sunday.
  const localDate = partsInZone(start, settings.timezone).date;
  const existing = await getBookings();
  const offered = slotsFor(service, settings, existing, localDate);
  const match = offered.find((s) => s.startIso === start.toISOString());
  if (!match) {
    return NextResponse.json(
      { error: "That time is no longer available. Please choose another." },
      { status: 409 }
    );
  }

  const booking: Booking = {
    id: `bkg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    serviceId,
    serviceName: service.name,
    start: match.startIso,
    end: match.endIso,
    name,
    email,
    phone: phone || undefined,
    notes: notes || undefined,
    status: "requested",
    createdAt: new Date().toISOString(),
  };

  try {
    if (conflictsWith(existing, booking.start, booking.end)) {
      return NextResponse.json({ error: "That time was just taken. Please choose another." }, { status: 409 });
    }
    await saveBookings([...existing, booking]);

    // Read back and settle any race deterministically.
    const after = await getBookings();
    const rivals = after.filter(
      (b) => b.id !== booking.id && b.status !== "cancelled" && overlaps(booking, b)
    );
    if (rivals.some((r) => loses(booking, r))) {
      await saveBookings((await getBookings()).filter((b) => b.id !== booking.id));
      return NextResponse.json({ error: "That time was just taken. Please choose another." }, { status: 409 });
    }
  } catch (e) {
    console.error("booking store failed:", e);
    return NextResponse.json({ error: "Could not save the booking." }, { status: 500 });
  }

  const when = `${friendlyDate(localDate, settings.timezone)} at ${friendlyTime(match.localTime)}`;
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_TO_EMAIL;
  if (apiKey && to) {
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(apiKey);
      const from = "Bookings <onboarding@resend.dev>";
      await resend.emails.send({
        from,
        to,
        replyTo: email,
        subject: `New booking: ${service.name}, ${when}`,
        text: `${name} booked ${service.name}.\n\nWhen: ${when} (${settings.timezone})\nEmail: ${email}\nPhone: ${phone || "(none)"}\n\nNotes:\n${notes || "(none)"}`,
      });
      await resend.emails.send({
        from,
        to: email,
        subject: `Your booking: ${service.name}, ${when}`,
        text: `Thanks ${name}, your booking is in the diary.\n\nWhat: ${service.name}\nWhen: ${when} (${settings.timezone})\n\nIf you need to change or cancel it, reply to this email.`,
      });
    } catch (e) {
      // The booking is already saved; email delivery is best-effort.
      console.error("booking email failed:", e);
    }
  }

  return NextResponse.json({ ok: true, when, timezone: settings.timezone });
}
