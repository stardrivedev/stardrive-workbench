"use server";

import { revalidatePath } from "next/cache";
import { assertAuthenticated } from "@/lib/cms/auth";
import {
  getAvailability,
  getBookings,
  getServices,
  saveAvailability,
  saveBookings,
  saveServices,
} from "./data";
import type { AvailabilitySettings, Booking, BookingStatus, Service } from "./types";

export async function getBookingDataAction(): Promise<{
  services: Service[];
  availability: AvailabilitySettings | null;
  bookings: Booking[];
  error?: string;
}> {
  try {
    await assertAuthenticated();
    const [services, availability, bookings] = await Promise.all([
      getServices(),
      getAvailability(),
      getBookings(),
    ]);
    return { services, availability, bookings };
  } catch (e) {
    return { services: [], availability: null, bookings: [], error: String(e) };
  }
}

export async function saveServicesAction(services: Service[]): Promise<{ success: boolean; error?: string }> {
  try {
    await assertAuthenticated();
    await saveServices(services);
    revalidatePath("/book");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function saveAvailabilityAction(
  settings: AvailabilitySettings
): Promise<{ success: boolean; error?: string }> {
  try {
    await assertAuthenticated();
    await saveAvailability(settings);
    revalidatePath("/book");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Move one booking's status. Cancelling frees the slot again, which is why
 * this is a status change rather than a delete: the record stays, so the
 * owner can still see who booked and when they cancelled.
 */
export async function setBookingStatusAction(
  id: string,
  status: BookingStatus
): Promise<{ success: boolean; error?: string }> {
  try {
    await assertAuthenticated();
    const bookings = await getBookings();
    await saveBookings(bookings.map((b) => (b.id === id ? { ...b, status } : b)));
    revalidatePath("/book");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
