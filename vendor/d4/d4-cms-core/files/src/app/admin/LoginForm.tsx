"use client";

import { useActionState } from "react";
import { verifyPasswordAction, verifyTotpAction } from "./actions";

const inputClass =
  "w-full rounded-md border border-heading/15 bg-surface px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-accent";

export default function LoginForm() {
  const [pwState, pwAction, pwPending] = useActionState(verifyPasswordAction, null);
  const [totpState, totpAction, totpPending] = useActionState(verifyTotpAction, null);

  const step: "password" | "totp" =
    pwState && "step" in pwState && pwState.step === "totp" ? "totp" : "password";

  if (step === "totp") {
    return (
      <form action={totpAction} className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-heading">
            Authenticator code
          </span>
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            className={inputClass}
            placeholder="123456"
          />
        </label>
        {totpState?.error && <p className="text-sm text-red-600">{totpState.error}</p>}
        <button
          type="submit"
          disabled={totpPending}
          className="w-full rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-strong disabled:opacity-60"
        >
          {totpPending ? "Verifying…" : "Verify"}
        </button>
      </form>
    );
  }

  return (
    <form action={pwAction} className="space-y-4">
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium text-heading">Password</span>
        <input name="password" type="password" required autoFocus className={inputClass} />
      </label>
      {pwState && "error" in pwState && pwState.error && (
        <p className="text-sm text-red-600">{pwState.error}</p>
      )}
      <button
        type="submit"
        disabled={pwPending}
        className="w-full rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-strong disabled:opacity-60"
      >
        {pwPending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
