import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/cms/auth";
import Dashboard from "./Dashboard";

// Auth depends on the request cookie, so these must render per-request, never
// be statically prerendered (a build-time render bakes in the logged-out
// redirect and the admin can never be reached).
export const dynamic = "force-dynamic";

export const metadata = { title: "Dashboard", robots: { index: false } };

export default async function DashboardPage() {
  if (!(await isAuthenticated())) redirect("/admin");
  return <Dashboard />;
}
