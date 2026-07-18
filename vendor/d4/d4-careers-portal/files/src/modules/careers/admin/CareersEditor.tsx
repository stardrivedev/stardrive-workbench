"use client";

import { useEffect, useState } from "react";
import { getJobsAction, saveJobsAction } from "../actions";
import type { Job } from "../types";

const inputClass =
  "w-full rounded-md border border-heading/15 bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

const JOB_TYPES: Job["type"][] = ["Full-Time", "Part-Time", "Contract", "Internship"];

function emptyJob(): Job {
  return {
    id: `job-${Date.now().toString(36)}`,
    title: "",
    type: "Full-Time",
    location: "",
    description: "",
    requirements: [],
    postedAt: new Date().toISOString().slice(0, 10),
  };
}

export default function CareersEditor() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [editing, setEditing] = useState<Job | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    getJobsAction().then((res) => {
      if (res.error) setStatus(res.error);
      else setJobs(res.jobs);
    });
  }, []);

  async function persist(next: Job[]) {
    setJobs(next);
    setStatus("Saving…");
    const res = await saveJobsAction(next);
    setStatus(res.success ? "Saved." : res.error ?? "Save failed.");
  }

  function submitEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const data = new FormData(e.currentTarget);
    const updated: Job = {
      ...editing,
      title: String(data.get("title") ?? "").trim(),
      type: (String(data.get("type")) as Job["type"]) || "Full-Time",
      location: String(data.get("location") ?? "").trim(),
      description: String(data.get("description") ?? "").trim(),
      requirements: String(data.get("requirements") ?? "")
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean),
    };
    const exists = jobs.some((j) => j.id === updated.id);
    persist(exists ? jobs.map((j) => (j.id === updated.id ? updated : j)) : [...jobs, updated]);
    setEditing(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Job postings</h2>
        <button
          type="button"
          onClick={() => setEditing(emptyJob())}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong"
        >
          Add posting
        </button>
      </div>

      {status && <p className="text-sm text-muted">{status}</p>}

      {editing && (
        <form
          onSubmit={submitEdit}
          className="space-y-4 rounded-md border border-heading/10 bg-surface p-5"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">Title</span>
              <input name="title" defaultValue={editing.title} required className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Type</span>
              <select name="type" defaultValue={editing.type} className={inputClass}>
                {JOB_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Location</span>
            <input
              name="location"
              defaultValue={editing.location}
              placeholder="Remote, On-site city, etc."
              className={inputClass}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Description</span>
            <textarea
              name="description"
              defaultValue={editing.description}
              required
              rows={5}
              className={inputClass}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Requirements (one per line)</span>
            <textarea
              name="requirements"
              defaultValue={editing.requirements.join("\n")}
              rows={4}
              className={inputClass}
            />
          </label>
          <div className="flex gap-3">
            <button
              type="submit"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong"
            >
              Save posting
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-md border border-heading/15 px-4 py-2 text-sm hover:border-accent"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {jobs.length === 0 && !editing ? (
        <p className="text-sm text-muted">No postings yet.</p>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="flex items-center justify-between gap-4 rounded-md border border-heading/10 bg-surface px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium text-heading">{job.title || "(untitled)"}</p>
                <p className="text-xs text-muted">
                  {job.type}
                  {job.location ? ` · ${job.location}` : ""} · posted {job.postedAt}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(job)}
                  className="rounded-md border border-heading/15 px-3 py-1.5 text-xs hover:border-accent hover:text-accent"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => persist(jobs.filter((j) => j.id !== job.id))}
                  className="rounded-md border border-heading/15 px-3 py-1.5 text-xs text-red-600 hover:border-red-400"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
