"use client";

import { useEffect, useState } from "react";
import {
  getBookingDataAction,
  saveAvailabilityAction,
  saveServicesAction,
  setBookingStatusAction,
} from "../actions";
import { DAY_NAMES, DEFAULT_AVAILABILITY } from "../types";
import type { AvailabilitySettings, Booking, Service } from "../types";

const inputClass =
  "w-full rounded-md border border-heading/15 bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

const WEEK = [1, 2, 3, 4, 5, 6, 0];

function emptyService(): Service {
  return { id: `svc-${Date.now().toString(36)}`, name: "", durationMin: 60 };
}

/** Instant to "Sat 15 Aug, 2:30pm" in the diary's own zone. */
function whenLabel(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function BookingEditor() {
  const [services, setServices] = useState<Service[]>([]);
  const [availability, setAvailability] = useState<AvailabilitySettings>(DEFAULT_AVAILABILITY);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [editing, setEditing] = useState<Service | null>(null);
  const [tab, setTab] = useState<"diary" | "services" | "hours">("diary");
  const [status, setStatus] = useState("");

  useEffect(() => {
    getBookingDataAction().then((res) => {
      if (res.error) setStatus(res.error);
      setServices(res.services);
      setBookings(res.bookings);
      if (res.availability) setAvailability(res.availability);
    });
  }, []);

  async function persistServices(next: Service[]) {
    setServices(next);
    setStatus("Saving…");
    const res = await saveServicesAction(next);
    setStatus(res.success ? "Saved." : res.error ?? "Save failed.");
  }

  async function persistAvailability(next: AvailabilitySettings) {
    setAvailability(next);
    setStatus("Saving…");
    const res = await saveAvailabilityAction(next);
    setStatus(res.success ? "Saved." : res.error ?? "Save failed.");
  }

  async function changeStatus(id: string, next: Booking["status"]) {
    setBookings((bs) => bs.map((b) => (b.id === id ? { ...b, status: next } : b)));
    const res = await setBookingStatusAction(id, next);
    setStatus(res.success ? "Saved." : res.error ?? "Save failed.");
  }

  function toggleDay(day: number, on: boolean) {
    const windows = on
      ? [...availability.windows, { day, start: "09:00", end: "17:00" }]
      : availability.windows.filter((w) => w.day !== day);
    persistAvailability({ ...availability, windows });
  }

  function setWindow(day: number, patch: { start?: string; end?: string }) {
    persistAvailability({
      ...availability,
      windows: availability.windows.map((w) => (w.day === day ? { ...w, ...patch } : w)),
    });
  }

  function submitService(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const data = new FormData(e.currentTarget);
    const updated: Service = {
      ...editing,
      name: String(data.get("name") ?? "").trim(),
      durationMin: Math.max(5, Number(data.get("durationMin") ?? 60) || 60),
      description: String(data.get("description") ?? "").trim() || undefined,
      price: String(data.get("price") ?? "").trim() || undefined,
      hidden: data.get("hidden") === "on",
    };
    if (!updated.name) {
      setStatus("A service needs a name.");
      return;
    }
    const exists = services.some((s) => s.id === updated.id);
    persistServices(exists ? services.map((s) => (s.id === updated.id ? updated : s)) : [...services, updated]);
    setEditing(null);
  }

  const upcoming = bookings
    .filter((b) => Date.parse(b.end) >= Date.now())
    .sort((a, b) => a.start.localeCompare(b.start));
  const past = bookings
    .filter((b) => Date.parse(b.end) < Date.now())
    .sort((a, b) => b.start.localeCompare(a.start));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Bookings</h2>
        <div className="flex gap-1 rounded-md border border-heading/15 p-1 text-sm">
          {(["diary", "services", "hours"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1 capitalize ${tab === t ? "bg-accent text-white" : ""}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {status && <p className="text-sm text-muted">{status}</p>}

      {tab === "diary" && (
        <div className="space-y-6">
          <section>
            <h3 className="mb-2 text-sm font-semibold">Upcoming</h3>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted">Nothing booked yet.</p>
            ) : (
              <ul className="space-y-2">
                {upcoming.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-heading/10 bg-surface p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {whenLabel(b.start, availability.timezone)} · {b.serviceName}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {b.name} · {b.email}
                        {b.phone ? ` · ${b.phone}` : ""}
                        {b.status === "cancelled" ? " · cancelled" : b.status === "confirmed" ? " · confirmed" : ""}
                      </p>
                      {b.notes ? <p className="mt-1 text-xs text-muted">{b.notes}</p> : null}
                    </div>
                    <div className="flex shrink-0 gap-3 text-sm">
                      {b.status !== "confirmed" && (
                        <button type="button" onClick={() => changeStatus(b.id, "confirmed")} className="underline">Confirm</button>
                      )}
                      {b.status !== "cancelled" && (
                        <button type="button" onClick={() => changeStatus(b.id, "cancelled")} className="text-muted underline">Cancel</button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {past.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold">Past</h3>
              <ul className="space-y-2">
                {past.slice(0, 20).map((b) => (
                  <li key={b.id} className="rounded-lg border border-heading/10 bg-surface p-3 text-xs text-muted">
                    {whenLabel(b.start, availability.timezone)} · {b.serviceName} · {b.name}
                    {b.status === "cancelled" ? " · cancelled" : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {tab === "services" && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setEditing(emptyService())}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong"
          >
            Add service
          </button>

          {editing && (
            <form onSubmit={submitService} className="space-y-4 rounded-lg border border-heading/15 bg-surface p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="name">Service name</label>
                  <input id="name" name="name" defaultValue={editing.name} className={inputClass} required />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="durationMin">Length (minutes)</label>
                  <input id="durationMin" name="durationMin" type="number" min={5} step={5} defaultValue={editing.durationMin} className={inputClass} required />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="price">Price (optional)</label>
                  <input id="price" name="price" defaultValue={editing.price ?? ""} placeholder="£45" className={inputClass} />
                  <p className="mt-1 text-xs text-muted">Shown to customers. No payment is taken here.</p>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="description">Description (optional)</label>
                <textarea id="description" name="description" rows={3} defaultValue={editing.description ?? ""} className={inputClass} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="hidden" defaultChecked={editing.hidden} />
                Hide from the booking page
              </label>
              <div className="flex gap-3">
                <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong">Save service</button>
                <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-heading/15 px-4 py-2 text-sm">Cancel</button>
              </div>
            </form>
          )}

          {services.length === 0 ? (
            <p className="text-sm text-muted">No services yet. Customers cannot book until there is at least one.</p>
          ) : (
            <ul className="space-y-2">
              {services.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-4 rounded-lg border border-heading/10 bg-surface p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{s.name}</p>
                    <p className="text-xs text-muted">
                      {s.durationMin} min{s.price ? ` · ${s.price}` : ""}{s.hidden ? " · hidden" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-3 text-sm">
                    <button type="button" onClick={() => setEditing(s)} className="underline">Edit</button>
                    <button type="button" onClick={() => persistServices(services.filter((x) => x.id !== s.id))} className="text-muted underline">Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "hours" && (
        <div className="space-y-5 rounded-lg border border-heading/15 bg-surface p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="timezone">Timezone</label>
              <input
                id="timezone"
                value={availability.timezone}
                onChange={(e) => setAvailability({ ...availability, timezone: e.target.value })}
                onBlur={() => persistAvailability(availability)}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-muted">Every time on the booking page is shown in this zone.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="slot">Slot spacing (minutes)</label>
              <input
                id="slot"
                type="number"
                min={5}
                step={5}
                value={availability.slotIntervalMin}
                onChange={(e) => setAvailability({ ...availability, slotIntervalMin: Number(e.target.value) || 30 })}
                onBlur={() => persistAvailability(availability)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="lead">Earliest booking (hours from now)</label>
              <input
                id="lead"
                type="number"
                min={0}
                value={availability.leadTimeHours}
                onChange={(e) => setAvailability({ ...availability, leadTimeHours: Number(e.target.value) || 0 })}
                onBlur={() => persistAvailability(availability)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="ahead">How far ahead (days)</label>
              <input
                id="ahead"
                type="number"
                min={1}
                max={365}
                value={availability.maxDaysAhead}
                onChange={(e) => setAvailability({ ...availability, maxDaysAhead: Number(e.target.value) || 60 })}
                onBlur={() => persistAvailability(availability)}
                className={inputClass}
              />
            </div>
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Working hours</legend>
            <div className="space-y-2">
              {WEEK.map((day) => {
                const w = availability.windows.find((x) => x.day === day);
                return (
                  <div key={day} className="flex flex-wrap items-center gap-3">
                    <span className="w-24 text-sm">{DAY_NAMES[day]}</span>
                    <label className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={Boolean(w)} onChange={(e) => toggleDay(day, e.target.checked)} />
                      Working
                    </label>
                    <input
                      type="time"
                      value={w?.start ?? "09:00"}
                      disabled={!w}
                      onChange={(e) => setWindow(day, { start: e.target.value })}
                      className="rounded-md border border-heading/15 bg-surface px-2 py-1 text-sm disabled:opacity-40"
                      aria-label={`${DAY_NAMES[day]} start`}
                    />
                    <span className="text-sm text-muted">to</span>
                    <input
                      type="time"
                      value={w?.end ?? "17:00"}
                      disabled={!w}
                      onChange={(e) => setWindow(day, { end: e.target.value })}
                      className="rounded-md border border-heading/15 bg-surface px-2 py-1 text-sm disabled:opacity-40"
                      aria-label={`${DAY_NAMES[day]} end`}
                    />
                  </div>
                );
              })}
            </div>
          </fieldset>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="closed">Days closed</label>
            <textarea
              id="closed"
              rows={3}
              value={(availability.closedDates ?? []).join("\n")}
              onChange={(e) =>
                setAvailability({
                  ...availability,
                  closedDates: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                })
              }
              onBlur={() => persistAvailability(availability)}
              placeholder={"2026-12-25\n2026-12-26"}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-muted">One date per line, as YYYY-MM-DD. Holidays and one-off closures.</p>
          </div>
        </div>
      )}
    </div>
  );
}
