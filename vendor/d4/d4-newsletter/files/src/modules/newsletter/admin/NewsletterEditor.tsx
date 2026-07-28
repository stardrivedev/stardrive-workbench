"use client";

import { useEffect, useState } from "react";
import {
  exportCsvAction,
  getSubscribersAction,
  removeSubscriberAction,
  unsubscribeAction,
} from "../actions";
import type { Subscriber } from "../types";

export default function NewsletterEditor() {
  const [subs, setSubs] = useState<Subscriber[]>([]);
  const [status, setStatus] = useState("");
  const [showGone, setShowGone] = useState(false);

  useEffect(() => {
    getSubscribersAction().then((res) => {
      if (res.error) setStatus(res.error);
      else setSubs(res.subscribers);
    });
  }, []);

  async function download() {
    const res = await exportCsvAction();
    if (!res.csv) {
      setStatus(res.error ?? "Export failed.");
      return;
    }
    // A blob URL keeps the list off any third party on its way to the disk.
    const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function unsubscribe(id: string) {
    setSubs((list) => list.map((s) => (s.id === id ? { ...s, unsubscribedAt: new Date().toISOString() } : s)));
    const res = await unsubscribeAction(id);
    if (!res.success) setStatus(res.error ?? "Failed.");
  }

  async function remove(id: string) {
    setSubs((list) => list.filter((s) => s.id !== id));
    const res = await removeSubscriberAction(id);
    if (!res.success) setStatus(res.error ?? "Failed.");
  }

  const active = subs.filter((s) => !s.unsubscribedAt);
  const gone = subs.filter((s) => s.unsubscribedAt);
  const shown = showGone ? gone : active;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          Newsletter
          <span className="ml-2 text-sm font-normal text-muted">
            {active.length} subscriber{active.length === 1 ? "" : "s"}
          </span>
        </h2>
        <div className="flex gap-3">
          <button type="button" onClick={() => setShowGone(!showGone)} className="rounded-md border border-heading/15 px-4 py-2 text-sm">
            {showGone ? `Show subscribed (${active.length})` : `Show unsubscribed (${gone.length})`}
          </button>
          <button type="button" onClick={download} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong">
            Export CSV
          </button>
        </div>
      </div>

      {status && <p className="text-sm text-muted">{status}</p>}

      <p className="text-sm text-muted">
        This module collects and stores the list. Sending is done from whichever platform you prefer:
        export the CSV and import it there.
      </p>

      {shown.length === 0 ? (
        <p className="text-sm text-muted">{showGone ? "Nobody has unsubscribed." : "No subscribers yet."}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-heading/10">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-heading/10 text-left text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="p-3 font-medium">Email</th>
                <th scope="col" className="p-3 font-medium">Name</th>
                <th scope="col" className="p-3 font-medium">Signed up</th>
                <th scope="col" className="p-3 font-medium">From</th>
                <th scope="col" className="p-3 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} className="border-b border-heading/10 last:border-0">
                  <td className="p-3">{s.email}</td>
                  <td className="p-3 text-muted">{s.name ?? ""}</td>
                  <td className="p-3 tabular-nums text-muted">{s.subscribedAt.slice(0, 10)}</td>
                  <td className="p-3 text-muted">{s.source ?? ""}</td>
                  <td className="p-3 text-right">
                    <div className="flex justify-end gap-3">
                      {!s.unsubscribedAt && (
                        <button type="button" onClick={() => unsubscribe(s.id)} className="underline">Unsubscribe</button>
                      )}
                      <button type="button" onClick={() => remove(s.id)} className="text-muted underline">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
