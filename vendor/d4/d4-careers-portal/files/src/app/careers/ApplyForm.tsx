"use client";

import { useState } from "react";

const inputClass =
  "w-full rounded-md border border-heading/15 bg-surface px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-accent";

export default function ApplyForm({ jobId, jobTitle }: { jobId: string; jobTitle: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  if (status === "sent") {
    return (
      <p className="text-sm font-medium text-accent">
        Application received. Thanks for applying, we&apos;ll be in touch.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-strong"
      >
        Apply for this position
      </button>
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    try {
      const res = await fetch("/api/careers/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, jobId, jobTitle }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || "Something went wrong.");
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-heading">Name</span>
          <input name="name" required maxLength={200} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-heading">Email</span>
          <input name="email" type="email" required maxLength={200} className={inputClass} />
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium text-heading">
          Tell us about yourself
        </span>
        <textarea
          name="message"
          required
          rows={5}
          maxLength={5000}
          className={inputClass}
          placeholder="Experience, links to work, and anything else we should know."
        />
      </label>
      {status === "error" && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={status === "sending"}
        className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-strong disabled:opacity-60"
      >
        {status === "sending" ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}
