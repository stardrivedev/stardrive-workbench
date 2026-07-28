"use client";

import { useEffect, useState } from "react";
import ImageDropzone from "@/components/cms/ImageDropzone";
import { getEventsAction, saveEventsAction } from "../actions";
import { splitEvents, whenLabel } from "../format";
import type { SiteEvent } from "../types";

const inputClass =
  "w-full rounded-md border border-heading/15 bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

function emptyEvent(): SiteEvent {
  return {
    id: `evt-${Date.now().toString(36)}`,
    title: "",
    date: new Date().toISOString().slice(0, 10),
  };
}

export default function EventsEditor() {
  const [events, setEvents] = useState<SiteEvent[]>([]);
  const [editing, setEditing] = useState<SiteEvent | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    getEventsAction().then((res) => {
      if (res.error) setStatus(res.error);
      else setEvents(res.events);
    });
  }, []);

  async function persist(next: SiteEvent[]) {
    setEvents(next);
    setStatus("Saving…");
    const res = await saveEventsAction(next);
    setStatus(res.success ? "Saved." : res.error ?? "Save failed.");
  }

  function submitEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const data = new FormData(e.currentTarget);
    const text = (k: string) => String(data.get(k) ?? "").trim() || undefined;
    const updated: SiteEvent = {
      ...editing,
      title: String(data.get("title") ?? "").trim(),
      date: String(data.get("date") ?? "").trim(),
      endDate: text("endDate"),
      startTime: text("startTime"),
      endTime: text("endTime"),
      venue: text("venue"),
      address: text("address"),
      description: text("description"),
      price: text("price"),
      ticketUrl: text("ticketUrl"),
    };
    if (!updated.title || !updated.date) {
      setStatus("A title and a date are required.");
      return;
    }
    if (updated.endDate && updated.endDate < updated.date) {
      setStatus("The last day cannot be before the first day.");
      return;
    }
    const exists = events.some((x) => x.id === updated.id);
    persist(exists ? events.map((x) => (x.id === updated.id ? updated : x)) : [...events, updated]);
    setEditing(null);
  }

  const { upcoming, past } = splitEvents(events);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Events</h2>
        <button
          type="button"
          onClick={() => setEditing(emptyEvent())}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong"
        >
          Add event
        </button>
      </div>

      {status && <p className="text-sm text-muted">{status}</p>}

      {editing && (
        <form onSubmit={submitEdit} className="space-y-4 rounded-lg border border-heading/15 bg-surface p-5">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="title">Title</label>
            <input id="title" name="title" defaultValue={editing.title} className={inputClass} required />
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="date">Date</label>
              <input id="date" name="date" type="date" defaultValue={editing.date} className={inputClass} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="endDate">Last day (optional)</label>
              <input id="endDate" name="endDate" type="date" defaultValue={editing.endDate ?? ""} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="startTime">Starts (optional)</label>
              <input id="startTime" name="startTime" type="time" defaultValue={editing.startTime ?? ""} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="endTime">Ends (optional)</label>
              <input id="endTime" name="endTime" type="time" defaultValue={editing.endTime ?? ""} className={inputClass} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="venue">Venue (optional)</label>
              <input id="venue" name="venue" defaultValue={editing.venue ?? ""} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="address">Address (optional)</label>
              <input id="address" name="address" defaultValue={editing.address ?? ""} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="price">Price (optional)</label>
              <input id="price" name="price" defaultValue={editing.price ?? ""} placeholder="Free, or £12 on the door" className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="ticketUrl">Ticket link (optional)</label>
              <input id="ticketUrl" name="ticketUrl" type="url" defaultValue={editing.ticketUrl ?? ""} className={inputClass} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="description">Description (optional)</label>
            <textarea id="description" name="description" rows={4} defaultValue={editing.description ?? ""} className={inputClass} />
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium">Image (optional)</span>
            {editing.image ? (
              <div className="mb-2 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={editing.image} alt="" className="h-16 w-24 rounded object-cover" />
                <button type="button" onClick={() => setEditing({ ...editing, image: undefined })} className="text-sm text-muted underline">Remove</button>
              </div>
            ) : null}
            <ImageDropzone onUploaded={(url) => setEditing({ ...editing, image: url })} label="Add a poster or photo" />
          </div>

          <div className="flex gap-3">
            <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong">Save event</button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-heading/15 px-4 py-2 text-sm">Cancel</button>
          </div>
        </form>
      )}

      {events.length === 0 ? (
        <p className="text-sm text-muted">No events yet. Add the first one above.</p>
      ) : (
        <>
          <section>
            <h3 className="mb-2 text-sm font-semibold">Upcoming</h3>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted">Nothing upcoming.</p>
            ) : (
              <ul className="space-y-2">
                {upcoming.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-4 rounded-lg border border-heading/10 bg-surface p-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{e.title}</p>
                      <p className="text-xs text-muted">{whenLabel(e)}{e.venue ? ` · ${e.venue}` : ""}</p>
                    </div>
                    <div className="flex shrink-0 gap-3 text-sm">
                      <button type="button" onClick={() => setEditing(e)} className="underline">Edit</button>
                      <button type="button" onClick={() => persist(events.filter((x) => x.id !== e.id))} className="text-muted underline">Delete</button>
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
                {past.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-4 rounded-lg border border-heading/10 bg-surface p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{e.title}</p>
                      <p className="text-xs text-muted">{whenLabel(e)}</p>
                    </div>
                    <div className="flex shrink-0 gap-3 text-sm">
                      <button type="button" onClick={() => setEditing(e)} className="underline">Edit</button>
                      <button type="button" onClick={() => persist(events.filter((x) => x.id !== e.id))} className="text-muted underline">Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
