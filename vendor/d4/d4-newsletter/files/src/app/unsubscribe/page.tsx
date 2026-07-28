import type { Metadata } from "next";
import { getSubscribers, saveSubscribers } from "@/modules/newsletter/data";
import PageHeader from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * One-click unsubscribe from an emailed link.
 *
 * The token is the whole authorisation, so it is compared against a stored
 * random value and never against the address itself: a link built from a
 * guessed email must not be able to remove somebody else. An unknown token
 * says so plainly rather than pretending to have worked, because a person who
 * wants out needs to know whether they are actually out.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  let outcome: "done" | "already" | "unknown" = "unknown";

  if (token && /^[0-9a-f]{48}$/.test(token)) {
    const subs = await getSubscribers();
    const match = subs.find((s) => s.token === token);
    if (match) {
      if (match.unsubscribedAt) {
        outcome = "already";
      } else {
        match.unsubscribedAt = new Date().toISOString();
        await saveSubscribers(subs);
        outcome = "done";
      }
    }
  }

  const message =
    outcome === "done"
      ? "You have been removed from the mailing list. You will not receive any more emails from us."
      : outcome === "already"
        ? "You were already unsubscribed. Nothing more will be sent to you."
        : "That unsubscribe link is not valid. It may have already been used, or the address may have been removed. Get in touch and we will sort it out.";

  return (
    <>
      <PageHeader eyebrow="Newsletter" title="Unsubscribe" />
      <section className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <p className="text-sm leading-6">{message}</p>
      </section>
    </>
  );
}
