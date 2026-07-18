import { NextResponse } from "next/server";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { isAuthenticated } from "@/lib/cms/auth";

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
};

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds the 10 MB limit." }, { status: 400 });
  }

  const stamp = new Date().toISOString().slice(0, 7).replace("-", "");
  const safeBase = (file.name.replace(/\.[^.]*$/, "") || "upload")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .slice(0, 80);
  const name = `${safeBase}-${Date.now().toString(36)}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { put } = await import("@vercel/blob");
      const blob = await put(`uploads/${stamp}/${name}`, buffer, {
        access: "public",
        contentType: file.type,
      });
      return NextResponse.json({ url: blob.url });
    } catch (e) {
      console.error("blob upload failed:", e);
      return NextResponse.json({ error: "Could not store the file." }, { status: 500 });
    }
  }

  // No Blob token configured: local-dev fallback, writes under public/uploads.
  const dir = path.join(process.cwd(), "public", "uploads", stamp);
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, name), buffer);
  } catch (e) {
    console.error("upload write failed:", e);
    return NextResponse.json({ error: "Could not store the file." }, { status: 500 });
  }

  return NextResponse.json({ url: `/uploads/${stamp}/${name}` });
}
