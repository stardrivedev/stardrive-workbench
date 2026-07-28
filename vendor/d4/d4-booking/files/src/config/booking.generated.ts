/**
 * GENERATED FILE (default). Stardrive overwrites this at assembly with the
 * services and working hours supplied in the owner's intake. Ships with no
 * services, because a diary that invents appointments the business does not
 * offer, at hours it does not work, produces real people at a locked door.
 * The /admin editor and the database always take precedence.
 */
import type { AvailabilitySettings, Service } from "@/modules/booking/types";

export const seedServices: Service[] = [];

/** Partial: merged over DEFAULT_AVAILABILITY, then over anything stored. */
export const seedAvailability: Partial<AvailabilitySettings> = {};
