import { redirect } from "next/navigation";
import { isAuthenticated, totpEnabled } from "@/lib/cms/auth";
import SetupClient from "./SetupClient";

// Auth depends on the request cookie, so these must render per-request, never
// be statically prerendered (a build-time render bakes in the logged-out
// redirect and the admin can never be reached).
export const dynamic = "force-dynamic";

export const metadata = { title: "Two-factor setup", robots: { index: false } };

export default async function Setup2faPage() {
  if (!(await isAuthenticated())) redirect("/admin");

  if (!totpEnabled()) {
    return (
      <section className="mx-auto max-w-md px-4 py-24 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Two-factor setup</h1>
        <div className="mt-6 space-y-4 text-sm leading-6 text-body">
          <p>
            Two-factor authentication is not enabled because <code>TOTP_SECRET</code> is
            not set in the environment.
          </p>
          <p className="text-muted">
            To enable it: generate a base32 secret, set it as <code>TOTP_SECRET</code>,
            restart the server, then return to this page to scan the QR code with an
            authenticator app.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-md px-4 py-24 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Two-factor setup</h1>
      <p className="mt-2 text-sm text-muted">
        Scan the QR code with an authenticator app such as Google Authenticator or Authy.
      </p>
      <div className="mt-8">
        <SetupClient />
      </div>
    </section>
  );
}
