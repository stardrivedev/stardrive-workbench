import type { Metadata } from "next";
import { getPayableItems } from "@/modules/payments/data";
import { safePaymentUrl } from "@/modules/payments/types";
import PageHeader from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Pay" };
export const dynamic = "force-dynamic";

export default async function PayPage() {
  const items = await getPayableItems();

  return (
    <>
      <PageHeader
        eyebrow="Payments"
        title="Pay online"
        subtitle="Secure checkout, handled by Stripe."
        slot="hero-pay"
      />
      <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        {items.length === 0 ? (
          <div className="rounded-md border border-heading/10 bg-surface px-6 py-8 text-sm text-muted">
            Nothing is available to pay for online just yet.
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            {items.map((item) => {
              const href = safePaymentUrl(item.url);
              if (!href) return null;
              return (
                <article key={item.id} className="flex h-full flex-col overflow-hidden rounded-lg border border-heading/10 bg-surface">
                  {item.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image} alt="" className="h-40 w-full object-cover" />
                  ) : null}
                  <div className="flex flex-1 flex-col p-6">
                    <h2 className="text-lg font-semibold">{item.name}</h2>
                    {item.price ? <p className="mt-1 text-sm font-medium text-accent">{item.price}</p> : null}
                    {item.description ? (
                      <p className="mt-3 flex-1 whitespace-pre-line text-sm leading-6 text-body">{item.description}</p>
                    ) : (
                      <div className="flex-1" />
                    )}
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-5 inline-block rounded-md bg-accent px-5 py-2.5 text-center text-sm font-medium text-white hover:bg-accent-strong"
                    >
                      {item.price ? `Pay ${item.price}` : "Pay now"}
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <p className="mt-10 text-xs text-muted">
          Payments are processed by Stripe. Your card details are entered on Stripe&rsquo;s own secure
          page and are never handled by this website.
        </p>
      </section>
    </>
  );
}
