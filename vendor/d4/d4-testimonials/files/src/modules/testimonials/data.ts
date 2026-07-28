/** Server-only accessors for the testimonials collection. */
import { readCollection, writeCollection } from "@/lib/cms/data-store";
import { seedTestimonials } from "@/config/testimonials.generated";
import type { Testimonial } from "./types";

export function getTestimonials(): Promise<Testimonial[]> {
  return readCollection<Testimonial[]>("testimonials", seedTestimonials);
}

export function saveTestimonials(items: Testimonial[]): Promise<void> {
  return writeCollection("testimonials", items);
}

/** Newest first, with undated entries last rather than dropped. */
export function byNewest(items: Testimonial[]): Testimonial[] {
  return [...items].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

/**
 * The average rating, or null when nobody has been rated. Null matters: an
 * aggregate of zero reviews rendered as "0 out of 5" would libel the owner.
 */
export function averageRating(items: Testimonial[]): { value: number; count: number } | null {
  const rated = items.filter((t) => typeof t.rating === "number" && t.rating > 0);
  if (!rated.length) return null;
  const total = rated.reduce((sum, t) => sum + (t.rating as number), 0);
  return { value: Math.round((total / rated.length) * 10) / 10, count: rated.length };
}
