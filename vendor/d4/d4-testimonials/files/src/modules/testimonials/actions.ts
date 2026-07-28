"use server";

import { revalidatePath } from "next/cache";
import { assertAuthenticated } from "@/lib/cms/auth";
import { getTestimonials, saveTestimonials } from "./data";
import type { Testimonial } from "./types";

export async function getTestimonialsAction(): Promise<{ testimonials: Testimonial[]; error?: string }> {
  try {
    await assertAuthenticated();
    return { testimonials: await getTestimonials() };
  } catch (e) {
    return { testimonials: [], error: String(e) };
  }
}

export async function saveTestimonialsAction(
  testimonials: Testimonial[]
): Promise<{ success: boolean; error?: string }> {
  try {
    await assertAuthenticated();
    await saveTestimonials(testimonials);
    revalidatePath("/testimonials");
    revalidatePath("/");
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
