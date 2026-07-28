"use client";

import { useEffect, useState } from "react";
import ImageDropzone from "@/components/cms/ImageDropzone";
import { getTeamAction, saveTeamAction } from "../actions";
import type { TeamMember } from "../types";

const inputClass =
  "w-full rounded-md border border-heading/15 bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

function emptyMember(): TeamMember {
  return { id: `mem-${Date.now().toString(36)}`, name: "", role: "" };
}

/** Parse "LinkedIn https://…" lines into labelled links, one per line. */
function parseLinks(raw: string): TeamMember["links"] {
  const links = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.search(/https?:\/\//);
      if (at === -1) return null;
      const href = line.slice(at).trim();
      const label = line.slice(0, at).trim() || "Profile";
      return { label, href };
    })
    .filter((l): l is { label: string; href: string } => l !== null);
  return links.length ? links : undefined;
}

const linksToText = (links: TeamMember["links"]) =>
  (links ?? []).map((l) => `${l.label} ${l.href}`).join("\n");

export default function TeamEditor() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    getTeamAction().then((res) => {
      if (res.error) setStatus(res.error);
      else setMembers(res.members);
    });
  }, []);

  async function persist(next: TeamMember[]) {
    setMembers(next);
    setStatus("Saving…");
    const res = await saveTeamAction(next);
    setStatus(res.success ? "Saved." : res.error ?? "Save failed.");
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= members.length) return;
    const next = [...members];
    [next[index], next[target]] = [next[target], next[index]];
    persist(next);
  }

  function submitEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const data = new FormData(e.currentTarget);
    const updated: TeamMember = {
      ...editing,
      name: String(data.get("name") ?? "").trim(),
      role: String(data.get("role") ?? "").trim(),
      bio: String(data.get("bio") ?? "").trim() || undefined,
      email: String(data.get("email") ?? "").trim() || undefined,
      phone: String(data.get("phone") ?? "").trim() || undefined,
      links: parseLinks(String(data.get("links") ?? "")),
    };
    if (!updated.name || !updated.role) {
      setStatus("A name and a role are required.");
      return;
    }
    const exists = members.some((m) => m.id === updated.id);
    persist(exists ? members.map((m) => (m.id === updated.id ? updated : m)) : [...members, updated]);
    setEditing(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Team</h2>
        <button
          type="button"
          onClick={() => setEditing(emptyMember())}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong"
        >
          Add person
        </button>
      </div>

      {status && <p className="text-sm text-muted">{status}</p>}

      {editing && (
        <form onSubmit={submitEdit} className="space-y-4 rounded-lg border border-heading/15 bg-surface p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="name">Name</label>
              <input id="name" name="name" defaultValue={editing.name} className={inputClass} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="role">Job title</label>
              <input id="role" name="role" defaultValue={editing.role} className={inputClass} required />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="bio">Biography (optional)</label>
            <textarea id="bio" name="bio" rows={4} defaultValue={editing.bio ?? ""} className={inputClass} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="email">Email (optional)</label>
              <input id="email" name="email" type="email" defaultValue={editing.email ?? ""} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="phone">Phone (optional)</label>
              <input id="phone" name="phone" defaultValue={editing.phone ?? ""} className={inputClass} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="links">Profile links (optional)</label>
            <textarea
              id="links"
              name="links"
              rows={3}
              defaultValue={linksToText(editing.links)}
              placeholder="LinkedIn https://linkedin.com/in/..."
              className={inputClass}
            />
            <p className="mt-1 text-xs text-muted">One per line: a label, then the full address.</p>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium">Photo (optional)</span>
            {editing.photo ? (
              <div className="mb-2 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={editing.photo} alt="" className="h-16 w-16 rounded-full object-cover" />
                <button type="button" onClick={() => setEditing({ ...editing, photo: undefined })} className="text-sm text-muted underline">
                  Remove
                </button>
              </div>
            ) : null}
            <ImageDropzone onUploaded={(url) => setEditing({ ...editing, photo: url })} label="Add a headshot" />
          </div>

          <div className="flex gap-3">
            <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong">
              Save person
            </button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-heading/15 px-4 py-2 text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}

      {members.length === 0 ? (
        <p className="text-sm text-muted">Nobody added yet. Add the first person above.</p>
      ) : (
        <ul className="space-y-3">
          {members.map((m, i) => (
            <li key={m.id} className="flex items-center justify-between gap-4 rounded-lg border border-heading/10 bg-surface p-4">
              <div className="flex min-w-0 items-center gap-3">
                {m.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.photo} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                ) : null}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="truncate text-xs text-muted">{m.role}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-sm">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="disabled:opacity-30" aria-label={`Move ${m.name} up`}>↑</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === members.length - 1} className="disabled:opacity-30" aria-label={`Move ${m.name} down`}>↓</button>
                <button type="button" onClick={() => setEditing(m)} className="underline">Edit</button>
                <button type="button" onClick={() => persist(members.filter((x) => x.id !== m.id))} className="text-muted underline">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
