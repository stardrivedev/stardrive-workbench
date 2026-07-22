import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/cms/auth";
import LoginForm from "./LoginForm";

// Auth depends on the request cookie, so these must render per-request, never
// be statically prerendered (a build-time render bakes in the logged-out
// redirect and the admin can never be reached).
export const dynamic = "force-dynamic";

export const metadata = { title: "Admin", robots: { index: false } };

export default async function AdminLoginPage() {
  if (await isAuthenticated()) redirect("/admin/dashboard");
  return (
    <section className="mx-auto flex max-w-md flex-col px-4 py-24 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Admin sign in</h1>
      <p className="mt-2 text-sm text-muted">Site content management.</p>
      <div className="mt-8">
        <LoginForm />
      </div>
    </section>
  );
}
