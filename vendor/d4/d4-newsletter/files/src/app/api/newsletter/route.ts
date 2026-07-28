import { NextResponse } from "next/server";
import { randomUUID, randomBytes } from "crypto";
import { getSubscribers, saveSubscribers, sameAddress } from "@/modules/newsletter/data";
import { DEFAULT_CONSENT } from "@/modules/newsletter/types";
import type { Subscriber } from "@/modules/newsletter/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().slice(0, 320);
  const name = String(body.name ?? "").trim().slice(0, 200);
  const source = String(body.source ?? "").trim().slice(0, 200);
  const consent = body.consent === true;
  const consentText = String(body.consentText ?? DEFAULT_CONSENT).slice(0, 500);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "That email address does not look right." }, { status: 400 });
  }
  // No ticked box, no subscription. The form cannot pre-tick it either.
  if (!consent) {
    return NextResponse.json({ error: "Please confirm you would like to receive emails." }, { status: 400 });
  }

  try {
    const subs = await getSubscribers();
    const existing = subs.find((s) => sameAddress(s.email, email));

    if (existing && !existing.unsubscribedAt) {
      // Already on the list. Reported as success on purpose: a different
      // answer here would let anyone test whether an address is subscribed.
      return NextResponse.json({ ok: true });
    }

    if (existing) {
      // Re-subscribing after leaving. New consent, new timestamp, new token.
      existing.unsubscribedAt = undefined;
      existing.subscribedAt = new Date().toISOString();
      existing.consentText = consentText;
      existing.token = randomBytes(24).toString("hex");
      if (name) existing.name = name;
      await saveSubscribers(subs);
    } else {
      const subscriber: Subscriber = {
        id: randomUUID(),
        email,
        name: name || undefined,
        subscribedAt: new Date().toISOString(),
        source: source || undefined,
        consentText,
        token: randomBytes(24).toString("hex"),
      };
      await saveSubscribers([...subs, subscriber]);
    }
  } catch (e) {
    console.error("subscribe failed:", e);
    return NextResponse.json({ error: "Could not add you to the list." }, { status: 500 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_TO_EMAIL;
  if (apiKey && to) {
    try {
      const { Resend } = await import("resend");
      await new Resend(apiKey).emails.send({
        from: "Newsletter <onboarding@resend.dev>",
        to,
        subject: `New subscriber: ${email}`,
        text: `${name || "Someone"} <${email}> subscribed${source ? ` from ${source}` : ""}.`,
      });
    } catch (e) {
      console.error("subscriber notification failed:", e);
    }
  }

  return NextResponse.json({ ok: true });
}
