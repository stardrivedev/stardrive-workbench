/**
 * GENERATED FILE (default). Stardrive may rewrite the bodies at assembly with
 * the business's own details filled in, but never sets `reviewed`.
 *
 * These are STARTING DRAFTS, not legal advice and not finished documents. They
 * exist so the owner has a structure to work from with their own adviser, and
 * every one of them ships with `reviewed: false`, which keeps it off the public
 * site until a person approves it. A generated privacy policy that goes live
 * unread makes promises to visitors nobody has checked, which is worse than
 * having no page at all.
 */
import type { LegalPage } from "@/modules/legal/types";

const REVIEW_BANNER =
  "> **This is a starting draft, not legal advice.** Read it end to end, replace\n" +
  "> everything in [square brackets], delete what does not apply, and have it\n" +
  "> checked by someone qualified before you approve it. Nothing here appears on\n" +
  "> the site until you mark it reviewed.\n";

export const seedLegalPages: LegalPage[] = [
  {
    slug: "privacy",
    title: "Privacy policy",
    reviewed: false,
    body:
      REVIEW_BANNER +
      `
## Who we are

[Business name] operates this website. If you have any questions about this
policy, contact us at [email address].

## What we collect

We collect information you give us directly:

- When you use a contact or enquiry form: your name, email address, and
  whatever you write in the message.
- [If you take bookings: the appointment details, your phone number.]
- [If you have a newsletter: your email address, and the date you subscribed.]

[Describe anything else you collect, including analytics, and remove this line.]

## Why we collect it

We use this information to reply to you, to provide the service you asked for,
and to keep records of it. We do not sell it to anyone.

## How long we keep it

[State a real retention period, for example: enquiries are kept for two years,
booking records for six years for accounting purposes.]

## Who else sees it

[List the services that process data for you, for example your email provider,
your hosting provider, your payment processor. Name them.]

## Your rights

You can ask us for a copy of the information we hold about you, ask us to
correct it, or ask us to delete it. Write to [email address] and we will
respond within [one month].

[If you are in the UK or the EU, mention the right to complain to your
supervisory authority, and name it.]

## Changes

We may update this policy. The date below shows when it last changed.
`,
  },
  {
    slug: "terms",
    title: "Terms and conditions",
    reviewed: false,
    body:
      REVIEW_BANNER +
      `
## About these terms

These terms cover your use of this website, operated by [Business name].
By using the site you accept them.

## Our services

[Describe what you provide, and what a customer can expect. If you take
bookings or payments, say what happens when one is made.]

## Cancellations and refunds

[State your actual policy. For example: appointments cancelled with less than
24 hours' notice may be charged in full.]

## Prices

[Say whether prices include tax, and that they can change.]

## Our liability

[This section in particular needs professional input. Do not copy generic
wording; the limits that apply to you depend on where you are and what you do.]

## Content on this site

The text and images on this site belong to [Business name] unless stated
otherwise.

## Getting in touch

Questions about these terms go to [email address].
`,
  },
  {
    slug: "cookies",
    title: "Cookie notice",
    reviewed: false,
    body:
      REVIEW_BANNER +
      `
## What this site uses

[Be accurate here, and only list what you genuinely use.]

This site uses a small number of cookies that are necessary for it to work:

- A theme preference, so the site remembers whether you chose light or dark.
- [If you have an admin area: a login session cookie for the site owner.]

[If you have added analytics or advertising, list them here and say what they
do. If you have not, delete this line and say so plainly: "We do not use
analytics or advertising cookies."]

## Managing cookies

You can clear or block cookies in your browser settings. Blocking the
necessary ones may stop parts of the site working.
`,
  },
];
