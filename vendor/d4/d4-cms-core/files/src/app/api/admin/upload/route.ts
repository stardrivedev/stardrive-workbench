import { NextResponse } from "next/server";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { isAuthenticated } from "@/lib/cms/auth";
import { hasObjectStore, putObject } from "@/lib/cms/object-store";

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
  const key = `uploads/${stamp}/${name}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  if (hasObjectStore()) {
    try {
      const stored = await putObject(key, buffer, file.type);
      return NextResponse.json({ url: stored.url });
    } catch (e) {
      console.error("upload failed:", e);
      // The real reason, not "something went wrong": this lands in front of
      // the site owner, who can do nothing with a generic apology but could
      // forward "the bucket name is wrong" to whoever set the site up.
      const reason = e instanceof Error ? e.message : "Could not store the file.";
      return NextResponse.json({ error: reason }, { status: 500 });
    }
  }

  /**
   * No object storage configured.
   *
   * In development, writing under public/uploads is convenient and harmless.
   * In production it is a trap: the file lands on the server's own disk, the
   * upload appears to work, and the next deploy erases it. Vercel, Netlify,
   * Railway, Render and every container host do exactly that. Refusing here
   * costs the owner one confusing minute; accepting costs them their
   * photographs weeks later, silently.
   */
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        error:
          "This site has nowhere permanent to keep uploaded files, so the " +
          "upload was refused rather than lost later. Whoever set the site " +
          "up needs to connect image storage (Vercel Blob, or any " +
          "S3-compatible storage such as Cloudflare R2 or Backblaze B2).",
      },
      { status: 503 }
    );
  }

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
