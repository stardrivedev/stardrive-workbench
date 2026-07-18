import { NextResponse } from "next/server";
import { createClient } from "@libsql/client";
import { existsSync, mkdirSync } from "fs";
import path from "path";

interface ContactMessage {
  name: string;
  email: string;
  message: string;
  /** Optional extras sent by the quote modal. */
  company?: string;
  phone?: string;
  topic?: string;
  receivedAt: string;
}

// Self-contained libSQL client: this template has no hard dependency on
// d4-cms-core, so it can't assume @/lib/cms/data-store exists. Same
// Turso-in-production / local-file-in-dev behavior, same env vars.
function localDbUrl(): string {
  const dir = path.join(process.cwd(), "data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return `file:${path.join(dir, "cms.db")}`;
}

const client = createClient(
  process.env.TURSO_DATABASE_URL
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: localDbUrl() }
);

let ready: Promise<unknown> | null = null;
function ensureTable() {
  if (!ready) {
    ready = client.execute(
      "CREATE TABLE IF NOT EXISTS collections (name TEXT PRIMARY KEY, data TEXT NOT NULL)"
    );
  }
  return ready;
}

async function storeLocally(msg: ContactMessage) {
  await ensureTable();
  const res = await client.execute({
    sql: "SELECT data FROM collections WHERE name = ?",
    args: ["messages"],
  });
  const existing: ContactMessage[] = res.rows[0] ? JSON.parse(res.rows[0].data as string) : [];
  existing.push(msg);
  await client.execute({
    sql: "INSERT INTO collections (name, data) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data",
    args: ["messages", JSON.stringify(existing)],
  });
}

export async function POST(req: Request) {
  let body: Partial<ContactMessage>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const name = (body.name ?? "").toString().trim().slice(0, 200);
  const email = (body.email ?? "").toString().trim().slice(0, 200);
  const message = (body.message ?? "").toString().trim().slice(0, 5000);
  const company = (body.company ?? "").toString().trim().slice(0, 200);
  const phone = (body.phone ?? "").toString().trim().slice(0, 50);
  const topic = (body.topic ?? "").toString().trim().slice(0, 200);

  if (!name || !email || !message) {
    return NextResponse.json({ error: "All fields are required." }, { status: 400 });
  }

  const msg: ContactMessage = { name, email, message, receivedAt: new Date().toISOString() };
  if (company) msg.company = company;
  if (phone) msg.phone = phone;
  if (topic) msg.topic = topic;

  // Always store (feeds the admin Inbox); email delivery is in addition,
  // best-effort. Fail only when neither channel accepted the message.
  let stored = true;
  try {
    await storeLocally(msg);
  } catch (e) {
    stored = false;
    console.error("contact store failed:", e);
  }

  let emailed = false;
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_TO_EMAIL;
  if (apiKey && to) {
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(apiKey);
      await resend.emails.send({
        from: "Website Contact <onboarding@resend.dev>",
        to,
        replyTo: email,
        subject: topic ? `Website inquiry (${topic}) from ${name}` : `Website inquiry from ${name}`,
        text: [
          message,
          "",
          `From: ${name} <${email}>`,
          company && `Company: ${company}`,
          phone && `Phone: ${phone}`,
          topic && `Topic: ${topic}`,
        ]
          .filter(Boolean)
          .join("\n"),
      });
      emailed = true;
    } catch (e) {
      console.error("contact email failed:", e);
    }
  }

  if (!stored && !emailed) {
    return NextResponse.json({ error: "Could not deliver message." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
