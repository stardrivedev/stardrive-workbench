"use client";

import { useRef, useState } from "react";

interface ImageDropzoneProps {
  /** Called with the public URL of the uploaded file. */
  onUploaded: (url: string) => void;
  label?: string;
  accept?: string;
}

export default function ImageDropzone({
  onUploaded,
  label = "Drop an image here or click to browse",
  accept = "image/*",
}: ImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || "Upload failed.");
      onUploaded(json.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) upload(file);
        }}
        className={`flex cursor-pointer items-center justify-center rounded-md border-2 border-dashed px-4 py-8 text-sm transition-colors ${
          dragging ? "border-accent bg-accent/5 text-accent" : "border-heading/15 text-muted hover:border-accent/50"
        }`}
      >
        {busy ? "Uploading…" : label}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          e.target.value = "";
        }}
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
