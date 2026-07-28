/** One day's trading hours. `closed` wins over any times present. */
export interface DayHours {
  /** 0 = Sunday, through 6 = Saturday, matching Date#getDay. */
  day: number;
  /** 24-hour "HH:MM". */
  opens?: string;
  closes?: string;
  closed?: boolean;
}

export interface PostalAddress {
  street?: string;
  city?: string;
  /** State, county or province. */
  region?: string;
  postalCode?: string;
  country?: string;
}

export interface Location {
  id: string;
  name: string;
  address: PostalAddress;
  phone?: string;
  email?: string;
  /** IANA zone, e.g. "Europe/London". Without it there is no "open now"
   *  indicator, because the server's own clock is not the shop's clock. */
  timezone?: string;
  hours: DayHours[];
  /** Decimal degrees. Both required for the map embed; absent means the
   *  page shows the address and a directions link instead of an invented pin. */
  lat?: number;
  lng?: number;
  /** Free text: parking, the entrance to use, accessibility. */
  notes?: string;
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

/** schema.org uses full English day URIs in openingHoursSpecification. */
export const SCHEMA_DAYS = [
  "https://schema.org/Sunday",
  "https://schema.org/Monday",
  "https://schema.org/Tuesday",
  "https://schema.org/Wednesday",
  "https://schema.org/Thursday",
  "https://schema.org/Friday",
  "https://schema.org/Saturday",
] as const;
