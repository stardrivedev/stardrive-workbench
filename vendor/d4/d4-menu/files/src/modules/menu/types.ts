/**
 * Dietary markers. A closed list rather than free text, because these are
 * exactly the words a guest with an allergy scans for, and "GF", "gluten-free"
 * and "no gluten" scattered across one menu are how someone gets hurt.
 */
export const DIET_MARKERS = {
  v: "Vegetarian",
  vg: "Vegan",
  gf: "Gluten free",
  df: "Dairy free",
  n: "Contains nuts",
  spicy: "Spicy",
} as const;

export type DietMarker = keyof typeof DIET_MARKERS;

export interface Dish {
  id: string;
  name: string;
  description?: string;
  /** Display text, not a number: "12", "£12.50", "9 / 14" for two sizes. */
  price?: string;
  markers?: DietMarker[];
  /** Free text for anything the markers cannot carry. */
  allergenNote?: string;
  /** Sold out or off today, without deleting the dish. */
  unavailable?: boolean;
}

export interface Course {
  id: string;
  /** "Starters", "Mains", "By the glass". */
  name: string;
  description?: string;
  dishes: Dish[];
}

export interface Menu {
  id: string;
  /** "Lunch", "Dinner", "Wine list". */
  name: string;
  description?: string;
  /** "Served 12pm to 3pm, Tuesday to Sunday". */
  servedWhen?: string;
  courses: Course[];
}
