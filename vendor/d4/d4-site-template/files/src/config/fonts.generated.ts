/**
 * GENERATED FILE. Written by d4-site-builder during assembly when the build
 * config names a pairing (see pairings.json in d4-site-builder). This
 * checked-in default is the "modern-signal" pairing so the template runs
 * standalone. Do not edit by hand; edits are overwritten on reassembly.
 */
import { Sora, Manrope } from "next/font/google";

export const displayFont = Sora({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const bodyFont = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});
