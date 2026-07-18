"use client";

import { useEffect, useState } from "react";
import {
  getInboxAction,
  type InboxMessage,
  type InboxApplication,
} from "@/lib/cms/inbox-actions";

type Tab = "messages" | "applications";

function formatWhen(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function InboxPanel() {
  const [tab, setTab] = useState<Tab>("messages");
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [applications, setApplications] = useState<InboxApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getInboxAction().then((res) => {
      if (res.error) setError(res.error);
      setMessages(res.messages);
      setApplications(res.applications);
      setLoading(false);
    });
  }, []);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "messages", label: "Messages", count: messages.length },
    { id: "applications", label: "Applications", count: applications.length },
  ];

  if (loading) return <p className="text-sm text-muted">Loading inbox…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;

  return (
    <div>
      <div className="flex gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-accent text-white"
                : "border border-heading/15 text-body hover:border-accent hover:text-accent"
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-4">
        {tab === "messages" &&
          (messages.length === 0 ? (
            <p className="rounded-md border border-heading/10 bg-base px-5 py-6 text-sm text-muted">
              No messages yet. Contact form submissions will appear here.
            </p>
          ) : (
            messages.map((m, i) => (
              <article
                key={`${m.receivedAt}-${i}`}
                className="rounded-lg border border-heading/10 bg-base p-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-heading">{m.name}</p>
                  <p className="text-xs text-muted">{formatWhen(m.receivedAt)}</p>
                </div>
                <a
                  href={`mailto:${m.email}`}
                  className="mt-0.5 block text-sm text-accent hover:underline"
                >
                  {m.email}
                </a>
                <p className="mt-3 whitespace-pre-line text-sm leading-6">{m.message}</p>
              </article>
            ))
          ))}

        {tab === "applications" &&
          (applications.length === 0 ? (
            <p className="rounded-md border border-heading/10 bg-base px-5 py-6 text-sm text-muted">
              No applications yet. Careers submissions will appear here when the
              careers module is installed.
            </p>
          ) : (
            applications.map((a) => (
              <article key={a.id} className="rounded-lg border border-heading/10 bg-base p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-heading">
                    {a.name}
                    {(a.jobTitle || a.jobId) && (
                      <span className="ml-2 rounded-md bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                        {a.jobTitle || a.jobId}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted">{formatWhen(a.receivedAt)}</p>
                </div>
                <a
                  href={`mailto:${a.email}`}
                  className="mt-0.5 block text-sm text-accent hover:underline"
                >
                  {a.email}
                </a>
                <p className="mt-3 whitespace-pre-line text-sm leading-6">{a.message}</p>
              </article>
            ))
          ))}
      </div>
    </div>
  );
}
