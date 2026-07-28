export interface SiteEvent {
  id: string;
  title: string;
  /** Calendar date "YYYY-MM-DD" in the venue's own local time. */
  date: string;
  /** 24-hour "HH:MM". Optional: plenty of events are all-day. */
  startTime?: string;
  endTime?: string;
  /** Last day, for events that run across several. */
  endDate?: string;
  venue?: string;
  address?: string;
  description?: string;
  /** Display text, e.g. "Free" or "£12 on the door". */
  price?: string;
  /** Where to buy or register. */
  ticketUrl?: string;
  image?: string;
}
