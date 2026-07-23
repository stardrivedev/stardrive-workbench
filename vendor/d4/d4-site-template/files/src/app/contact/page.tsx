import type { Metadata } from "next";
import { siteConfig } from "@/config/site";
import { getLiveContent } from "@/lib/site-content";
import PageHeader from "@/components/ui/PageHeader";
import ContactForm from "./ContactForm";

export const metadata: Metadata = { title: "Contact" };

export default async function ContactPage() {
  const content = await getLiveContent();
  const details = [
    siteConfig.contactEmail && {
      label: "Email",
      value: siteConfig.contactEmail,
      href: `mailto:${siteConfig.contactEmail}`,
    },
    siteConfig.phone && { label: "Phone", value: siteConfig.phone, href: undefined },
    siteConfig.address && { label: "Address", value: siteConfig.address, href: undefined },
  ].filter(Boolean) as { label: string; value: string; href?: string }[];

  return (
    <>
      <PageHeader
        eyebrow="Contact"
        title={content.contact.heading || "Let's talk"}
        subtitle={content.contact.intro || "Send a message and we'll get back to you."}
        slot="hero-contact"
      />
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">

      <div className="mt-12 grid gap-8 lg:grid-cols-[1fr_1.5fr] lg:gap-12">
        <div className="space-y-4">
          {details.map((d) => (
            <div key={d.label} className="rounded-xl border border-heading/10 bg-surface p-6">
              <p className="text-xs font-medium uppercase tracking-widest text-accent">
                {d.label}
              </p>
              {d.href ? (
                <a
                  href={d.href}
                  className="mt-1.5 block break-words font-medium text-heading transition-colors hover:text-accent"
                >
                  {d.value}
                </a>
              ) : (
                <p className="mt-1.5 break-words font-medium text-heading">{d.value}</p>
              )}
            </div>
          ))}
          {details.length === 0 && (
            <div className="rounded-xl border border-heading/10 bg-surface p-6 text-sm text-muted">
              Use the form to reach us. We read every message.
            </div>
          )}
        </div>

        <div className="rounded-xl border border-heading/10 bg-surface p-7 sm:p-9">
          <ContactForm />
        </div>
      </div>
      </section>
    </>
  );
}
