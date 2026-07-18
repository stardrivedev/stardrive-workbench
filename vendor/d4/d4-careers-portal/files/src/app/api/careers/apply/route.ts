import { NextResponse } from "next/server";
import { addApplication } from "@/modules/careers/data";
import type { Application } from "@/modules/careers/types";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const name = String(body.name ?? "").trim().slice(0, 200);
  const email = String(body.email ?? "").trim().slice(0, 200);
  const message = String(body.message ?? "").trim().slice(0, 5000);
  const jobId = String(body.jobId ?? "").trim().slice(0, 100);
  const jobTitle = String(body.jobTitle ?? "").trim().slice(0, 200);

  if (!name || !email || !message || !jobId) {
    return NextResponse.json({ error: "All fields are required." }, { status: 400 });
  }

  const application: Application = {
    id: `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    jobId,
    jobTitle,
    name,
    email,
    message,
    receivedAt: new Date().toISOString(),
  };

  try {
    await addApplication(application);
  } catch (e) {
    console.error("application store failed:", e);
    return NextResponse.json({ error: "Could not submit the application." }, { status: 500 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_TO_EMAIL;
  if (apiKey && to) {
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(apiKey);
      await resend.emails.send({
        from: "Careers <onboarding@resend.dev>",
        to,
        replyTo: email,
        subject: `Application: ${jobTitle || jobId} from ${name}`,
        text: `${message}\n\nPosition: ${jobTitle || jobId}\nFrom: ${name} <${email}>`,
      });
    } catch (e) {
      // The application is already stored; email delivery is best-effort.
      console.error("application email failed:", e);
    }
  }

  return NextResponse.json({ ok: true });
}
