import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/cms/auth";
import Dashboard from "./Dashboard";

export const metadata = { title: "Dashboard", robots: { index: false } };

export default async function DashboardPage() {
  if (!(await isAuthenticated())) redirect("/admin");
  return <Dashboard />;
}
