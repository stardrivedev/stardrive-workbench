"use client";

import { useEffect, useState } from "react";
import { getLocationsAction, saveLocationsAction } from "../actions";
import { DAY_NAMES } from "../types";
import type { DayHours, Location } from "../types";

const inputClass =
  "w-full rounded-md border border-heading/15 bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

/** Monday first, matching how a trading week is actually read. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

function defaultHours(): DayHours[] {
  return WEEK.map((day) => ({
    day,
    opens: "09:00",
    closes: "17:00",
    closed: day === 0 || day === 6,
  }));
}

function emptyLocation(): Location {
  return {
    id: `loc-${Date.now().toString(36)}`,
    name: "",
    address: {},
    // The browser knows the zone the owner is sitting in, which is nearly
    // always the shop's zone. Better than making them find the IANA name.
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    hours: defaultHours(),
  };
}

export default function LocationsEditor() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [editing, setEditing] = useState<Location | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    getLocationsAction().then((res) => {
      if (res.error) setStatus(res.error);
      else setLocations(res.locations);
    });
  }, []);

  async function persist(next: Location[]) {
    setLocations(next);
    setStatus("Saving…");
    const res = await saveLocationsAction(next);
    setStatus(res.success ? "Saved." : res.error ?? "Save failed.");
  }

  function setHour(day: number, patch: Partial<DayHours>) {
    if (!editing) return;
    setEditing({
      ...editing,
      hours: editing.hours.map((h) => (h.day === day ? { ...h, ...patch } : h)),
    });
  }

  function submitEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const data = new FormData(e.currentTarget);
    const num = (key: string) => {
      const raw = String(data.get(key) ?? "").trim();
      if (!raw) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    };
    const updated: Location = {
      ...editing,
      name: String(data.get("name") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim() || undefined,
      email: String(data.get("email") ?? "").trim() || undefined,
      timezone: String(data.get("timezone") ?? "").trim() || undefined,
      notes: String(data.get("notes") ?? "").trim() || undefined,
      lat: num("lat"),
      lng: num("lng"),
      address: {
        street: String(data.get("street") ?? "").trim() || undefined,
        city: String(data.get("city") ?? "").trim() || undefined,
        region: String(data.get("region") ?? "").trim() || undefined,
        postalCode: String(data.get("postalCode") ?? "").trim() || undefined,
        country: String(data.get("country") ?? "").trim() || undefined,
      },
    };
    if (!updated.name) {
      setStatus("A name is required (for a single site, the business name is fine).");
      return;
    }
    const exists = locations.some((l) => l.id === updated.id);
    persist(exists ? locations.map((l) => (l.id === updated.id ? updated : l)) : [...locations, updated]);
    setEditing(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Locations</h2>
        <button
          type="button"
          onClick={() => setEditing(emptyLocation())}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong"
        >
          Add location
        </button>
      </div>

      {status && <p className="text-sm text-muted">{status}</p>}

      {editing && (
        <form onSubmit={submitEdit} className="space-y-5 rounded-lg border border-heading/15 bg-surface p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="name">Location name</label>
              <input id="name" name="name" defaultValue={editing.name} className={inputClass} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="timezone">Timezone</label>
              <input id="timezone" name="timezone" defaultValue={editing.timezone ?? ""} className={inputClass} />
              <p className="mt-1 text-xs text-muted">Needed for the &ldquo;Open now&rdquo; indicator. Leave blank to hide it.</p>
            </div>
          </div>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-1 text-sm font-medium">Address</legend>
            <input name="street" placeholder="Street" defaultValue={editing.address.street ?? ""} className={inputClass} aria-label="Street" />
            <input name="city" placeholder="City or town" defaultValue={editing.address.city ?? ""} className={inputClass} aria-label="City or town" />
            <input name="region" placeholder="County, state or province" defaultValue={editing.address.region ?? ""} className={inputClass} aria-label="County, state or province" />
            <input name="postalCode" placeholder="Postcode or ZIP" defaultValue={editing.address.postalCode ?? ""} className={inputClass} aria-label="Postcode or ZIP" />
            <input name="country" placeholder="Country" defaultValue={editing.address.country ?? ""} className={inputClass} aria-label="Country" />
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="phone">Phone</label>
              <input id="phone" name="phone" defaultValue={editing.phone ?? ""} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" defaultValue={editing.email ?? ""} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="lat">Latitude (optional)</label>
              <input id="lat" name="lat" defaultValue={editing.lat ?? ""} className={inputClass} inputMode="decimal" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="lng">Longitude (optional)</label>
              <input id="lng" name="lng" defaultValue={editing.lng ?? ""} className={inputClass} inputMode="decimal" />
            </div>
          </div>
          <p className="text-xs text-muted">
            With both coordinates the page shows a map. Without them it shows the address and a directions
            link, and never an approximate pin.
          </p>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Opening hours</legend>
            <div className="space-y-2">
              {WEEK.map((day) => {
                const h = editing.hours.find((x) => x.day === day) ?? { day, closed: true };
                return (
                  <div key={day} className="flex flex-wrap items-center gap-3">
                    <span className="w-24 text-sm">{DAY_NAMES[day]}</span>
                    <label className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={!h.closed}
                        onChange={(e) => setHour(day, { closed: !e.target.checked })}
                      />
                      Open
                    </label>
                    <input
                      type="time"
                      value={h.opens ?? "09:00"}
                      disabled={h.closed}
                      onChange={(e) => setHour(day, { opens: e.target.value })}
                      className="rounded-md border border-heading/15 bg-surface px-2 py-1 text-sm disabled:opacity-40"
                      aria-label={`${DAY_NAMES[day]} opening time`}
                    />
                    <span className="text-sm text-muted">to</span>
                    <input
                      type="time"
                      value={h.closes ?? "17:00"}
                      disabled={h.closed}
                      onChange={(e) => setHour(day, { closes: e.target.value })}
                      className="rounded-md border border-heading/15 bg-surface px-2 py-1 text-sm disabled:opacity-40"
                      aria-label={`${DAY_NAMES[day]} closing time`}
                    />
                  </div>
                );
              })}
            </div>
          </fieldset>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="notes">Notes (optional)</label>
            <textarea id="notes" name="notes" rows={3} defaultValue={editing.notes ?? ""} placeholder="Parking, which entrance to use, accessibility" className={inputClass} />
          </div>

          <div className="flex gap-3">
            <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong">
              Save location
            </button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-heading/15 px-4 py-2 text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}

      {locations.length === 0 ? (
        <p className="text-sm text-muted">No locations yet. Add the first one above.</p>
      ) : (
        <ul className="space-y-3">
          {locations.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-4 rounded-lg border border-heading/10 bg-surface p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{l.name}</p>
                <p className="truncate text-xs text-muted">
                  {[l.address.street, l.address.city, l.address.postalCode].filter(Boolean).join(", ") || "No address yet"}
                </p>
              </div>
              <div className="flex shrink-0 gap-3 text-sm">
                <button type="button" onClick={() => setEditing(l)} className="underline">Edit</button>
                <button type="button" onClick={() => persist(locations.filter((x) => x.id !== l.id))} className="text-muted underline">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
