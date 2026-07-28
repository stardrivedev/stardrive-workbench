"use client";

import { useState } from "react";
import { DEFAULT_CONSENT } from "./types";

const inputClass =
  "w-full rounded-md border border-heading/15 bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

/**
 * Embeddable signup form.
 *
 * The consent box is never pre-ticked and the submit button does not work
 * without it. That is not decoration: an opt-in the visitor did not actively
 * make is not consent, and the exact wording shown here is stored against the
 * subscriber so the owner can evidence what was agreed.
 */
export default function SignupForm({
  title = "Stay in touch",
  blurb = "Occasional updates. No spam, and you can leave whenever you like.",
  consentText = DEFAULT_CONSENT,
  askName = false,
  source,
}: {
  title?: string;
  blurb?: string;
  consentText?: string;
  askName?: boolean;
  source?: string;
}) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          name: data.get("name"),
          consent,
          consentText,
          source: source ?? (typeof window !== "undefined" ? window.location.pathname : undefined),
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error ?? "Could not sign you up.");
        return;
      }
      setDone(true);
    } catch {
      setError("Could not sign you up. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-accent/30 bg-accent/5 p-6">
        <p className="text-sm font-medium">You are on the list. Thank you.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-heading/15 bg-surface p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {blurb ? <p className="mt-1 text-sm text-muted">{blurb}</p> : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {askName ? (
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Name</span>
            <input name="name" className={inputClass} />
          </label>
        ) : null}
        <label className={`block ${askName ? "" : "sm:col-span-2"}`}>
          <span className="mb-1 block text-sm font-medium">Email</span>
          <input name="email" type="email" required className={inputClass} />
        </label>
      </div>

      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1"
          required
        />
        <span>{consentText}</span>
      </label>

      <button
        type="submit"
        disabled={busy || !consent}
        className="mt-4 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-50"
      >
        {busy ? "Signing up…" : "Subscribe"}
      </button>

      {error ? (
        <p role="alert" className="mt-3 text-sm">
          {error}
        </p>
      ) : null}
    </form>
  );
}
