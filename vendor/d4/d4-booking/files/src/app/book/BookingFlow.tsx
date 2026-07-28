"use client";

import { useEffect, useState } from "react";
import type { Service } from "@/modules/booking/types";

const inputClass =
  "w-full rounded-md border border-heading/15 bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

interface Slot {
  startIso: string;
  endIso: string;
  localTime: string;
}

function friendlyTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h)) return hhmm;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

function friendlyDate(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(new Date(`${dateStr}T12:00:00Z`));
  } catch {
    return dateStr;
  }
}

export default function BookingFlow({
  services,
  dates,
  timezone,
}: {
  services: Service[];
  dates: string[];
  timezone: string;
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [date, setDate] = useState(dates[0] ?? "");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [chosen, setChosen] = useState<Slot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const service = services.find((s) => s.id === serviceId);

  useEffect(() => {
    if (!serviceId || !date) return;
    let cancelled = false;
    setLoading(true);
    setChosen(null);
    setError("");
    fetch(`/api/booking/slots?serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(date)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setSlots(data.slots ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load available times. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // A stale response must never repaint a newer selection.
    return () => {
      cancelled = true;
    };
  }, [serviceId, date]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!chosen || !service) return;
    const data = new FormData(e.currentTarget);
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId,
          start: chosen.startIso,
          name: data.get("name"),
          email: data.get("email"),
          phone: data.get("phone"),
          notes: data.get("notes"),
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error ?? "Could not complete the booking.");
        // A clash means the picker is out of date: reload the times.
        if (res.status === 409) {
          setChosen(null);
          const again = await fetch(
            `/api/booking/slots?serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(date)}`
          ).then((r) => r.json());
          setSlots(again.slots ?? []);
        }
        return;
      }
      setDone(json.when as string);
    } catch {
      setError("Could not complete the booking. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-accent/30 bg-accent/5 p-6">
        <h2 className="text-lg font-semibold">You are booked in</h2>
        <p className="mt-2 text-sm">
          {service?.name} on {done}.
        </p>
        <p className="mt-3 text-sm text-muted">
          A confirmation is on its way to the email address you gave us.
        </p>
      </div>
    );
  }

  if (!services.length) {
    return (
      <div className="rounded-md border border-heading/10 bg-surface px-6 py-8 text-sm text-muted">
        Online booking is not set up yet.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="service">What would you like to book?</label>
        <select id="service" value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={inputClass}>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.durationMin} min{s.price ? `, ${s.price}` : ""})
            </option>
          ))}
        </select>
        {service?.description ? <p className="mt-2 text-sm text-muted">{service.description}</p> : null}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="date">Which day?</label>
        <select id="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass}>
          {dates.map((d) => (
            <option key={d} value={d}>
              {friendlyDate(d)}
            </option>
          ))}
        </select>
        {!dates.length ? <p className="mt-2 text-sm text-muted">No days are open for booking at the moment.</p> : null}
      </div>

      <div>
        <h2 className="text-sm font-medium">Pick a time</h2>
        <p className="mb-3 text-xs text-muted">Times shown in {timezone}.</p>
        {loading && !slots ? (
          <p className="text-sm text-muted">Loading times…</p>
        ) : slots && slots.length === 0 ? (
          <p className="text-sm text-muted">Nothing free on this day. Try another.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(slots ?? []).map((s) => (
              <button
                key={s.startIso}
                type="button"
                onClick={() => setChosen(s)}
                aria-pressed={chosen?.startIso === s.startIso}
                className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                  chosen?.startIso === s.startIso
                    ? "border-accent bg-accent text-white"
                    : "border-heading/15 bg-surface hover:border-accent"
                }`}
              >
                {friendlyTime(s.localTime)}
              </button>
            ))}
          </div>
        )}
      </div>

      {chosen ? (
        <form onSubmit={submit} className="space-y-4 rounded-lg border border-heading/15 bg-surface p-5">
          <h2 className="text-sm font-medium">Your details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="name">Name</label>
              <input id="name" name="name" className={inputClass} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" className={inputClass} required />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium" htmlFor="phone">Phone (optional)</label>
              <input id="phone" name="phone" className={inputClass} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="notes">Anything we should know? (optional)</label>
            <textarea id="notes" name="notes" rows={3} className={inputClass} />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-60"
          >
            {loading ? "Booking…" : `Book ${friendlyTime(chosen.localTime)} on ${friendlyDate(date)}`}
          </button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-md border border-heading/15 bg-surface px-4 py-3 text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
