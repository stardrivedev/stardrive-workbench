export interface Testimonial {
  id: string;
  /** What the customer actually said. */
  quote: string;
  author: string;
  /** Role, company, or town. Optional, because plenty of reviews have none. */
  role?: string;
  /** 1 to 5. Omitted entirely when the owner did not record one, so the
   *  site never shows an invented score. */
  rating?: number;
  /** Uploaded headshot or logo. */
  photo?: string;
  /** ISO date "YYYY-MM-DD"; used for ordering and for Review structured data. */
  date?: string;
  /** Shown on the home page and in embedded strips; all of them show on
   *  /testimonials regardless. */
  featured?: boolean;
}
