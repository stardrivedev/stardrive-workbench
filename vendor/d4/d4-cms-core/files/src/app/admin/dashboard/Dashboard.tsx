"use client";

import { useState } from "react";
import { adminPanels } from "@/config/admin-panels.generated";
import { logoutAction } from "../actions";

export default function Dashboard() {
  const [activeId, setActiveId] = useState(adminPanels[0]?.id ?? "");
  const active = adminPanels.find((p) => p.id === activeId);

  return (
    <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Content dashboard</h1>
        <form action={logoutAction}>
          <button
            type="submit"
            className="rounded-md border border-heading/15 px-4 py-2 text-sm text-body transition-colors hover:border-accent hover:text-accent"
          >
            Sign out
          </button>
        </form>
      </div>

      {adminPanels.length === 0 ? (
        <div className="mt-10 rounded-md border border-heading/10 bg-surface px-6 py-8 text-sm text-muted">
          <p className="font-medium text-heading">No admin panels installed.</p>
          <p className="mt-2">
            Content modules (careers, insights, catalog, gallery) register their editors
            here when the site is assembled with them selected.
          </p>
        </div>
      ) : (
        <>
          <nav className="mt-8 flex flex-wrap gap-2 border-b border-heading/10 pb-px">
            {adminPanels.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setActiveId(p.id)}
                className={`rounded-t-md px-4 py-2 text-sm transition-colors ${
                  p.id === activeId
                    ? "border border-b-0 border-heading/10 bg-surface font-medium text-accent"
                    : "text-muted hover:text-heading"
                }`}
              >
                {p.label}
              </button>
            ))}
          </nav>
          <div className="mt-6">{active && <active.Component />}</div>
        </>
      )}
    </section>
  );
}
