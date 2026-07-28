export interface Service {
  id: string;
  name: string;
  /** Minutes. Drives both the slot grid and the end time of a booking. */
  durationMin: number;
  description?: string;
  /** Display only, e.g. "£45" or "from $80". Free text because pricing is
   *  rarely a single clean number and this module never takes payment. */
  price?: string;
  /** Hidden services stay bookable by direct link but leave the picker. */
  hidden?: boolean;
}

/** One weekly working window, in the business's own timezone. */
export interface AvailabilityWindow {
  /** 0 = Sunday, through 6 = Saturday. */
  day: number;
  /** 24-hour "HH:MM". */
  start: string;
  end: string;
}

export interface AvailabilitySettings {
  /** IANA zone, e.g. "Europe/London". The diary's clock, not the server's. */
  timezone: string;
  windows: AvailabilityWindow[];
  /** Minutes between slot start times. */
  slotIntervalMin: number;
  /** How soon someone may book. Stops a 9:01am booking for 9:05am. */
  leadTimeHours: number;
  /** How far ahead the calendar opens. */
  maxDaysAhead: number;
  /** ISO dates "YYYY-MM-DD" the business is shut regardless of the weekly grid. */
  closedDates: string[];
}

export type BookingStatus = "requested" | "confirmed" | "cancelled";

export interface Booking {
  id: string;
  serviceId: string;
  serviceName: string;
  /** Instants, stored as ISO strings in UTC. Display converts to the
   *  business timezone; storing local strings would break across DST. */
  start: string;
  end: string;
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  status: BookingStatus;
  createdAt: string;
}

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const DEFAULT_AVAILABILITY: AvailabilitySettings = {
  timezone: "UTC",
  windows: [1, 2, 3, 4, 5].map((day) => ({ day, start: "09:00", end: "17:00" })),
  slotIntervalMin: 30,
  leadTimeHours: 12,
  maxDaysAhead: 60,
  closedDates: [],
};
