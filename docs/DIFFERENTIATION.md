# Stardrive: What Actually Differentiates Us

This document exists to keep our own story honest. No hype, no claims we
cannot back up with what the product actually does today. Where a competitor
does something better than we do, it says so. Where we have a real gap, it
says so too. Written 2026-07-22, verified against current information at time
of writing; re-check before quoting any of this externally, since every
platform here ships changes constantly.

## The landscape, grouped honestly

**Proprietary no-code builders (Wix, Squarespace, Durable).** These generate
or let you drag-and-drop a site, then host it on their own infrastructure
with no way out. Wix has no export at all: no code, no clean content dump,
the design is trapped permanently. Durable is the same story for AI-generated
sites: no code export, the site lives on Durable's platform for as long as
you subscribe. Squarespace is slightly better: it will export blog posts and
basic pages as XML/CSV, but not the design, not products, not most page
types. None of these let an agency hand a client a real, ownable codebase.

**Design-first builders with partial export (Webflow, Framer).** Webflow
will export static HTML/CSS/JS on paid plans, and that part is genuinely
portable, you can host it on Netlify, Vercel, GitHub Pages, anywhere. But
Collections (Webflow's CMS) and any dynamic data do not export. A
content-driven Webflow site is locked to Webflow hosting the moment it needs
a CMS. Framer is more locked than Webflow: no native code export at all, the
published site runs on Framer's own React runtime, and there's no official
way to get clean markup out of it.

**WordPress-based AI builders (10Web).** Genuinely portable in principle,
because the output is a normal WordPress install, and WordPress itself is
host-agnostic. But in practice 10Web's own docs describe migrating away from
their hosting as "real work," not a one-click thing. The portability is real;
the friction to actually use it is also real.

**Agency/white-label platforms (Duda).** This is the closest thing to a
direct competitor in spirit: agencies use it to build many client sites at
scale, with white-label branding and an API. But code export is gated to
Duda's Agency-tier plan and above, and even then, an exported site "loses
builder editability" and needs a developer to actually stand it back up
elsewhere. And hosting is centralized: client sites live on Duda's own AWS
infrastructure, not on infrastructure the agency or the client owns.

**AI code-generation tools (v0, Lovable, Bolt.new).** These are the closest
match on code portability: Lovable and Bolt.new both export real, deployable
code and support pushing to GitHub, so you genuinely can take the output and
host it anywhere. v0 leans tightly on Vercel and, as of now, generates
frontend components without a backend. All three are excellent, general-
purpose "chat your way to an app" tools. None of them are built around
running an agency's actual production line: structured intake from a client,
a hard gate that blocks a build until it is genuinely finished (no
placeholder copy anywhere), multi-tenant accounts so many client projects
stay separated, or a workflow for handing off hosting per client rather than
per project.

## What actually differentiates Stardrive

**The output is a standalone, ownable codebase with zero required
dependency on us.** An assembled site is a real Next.js project. It runs,
builds, and deploys with no reference back to Stardrive at all; the engine
itself is never included in an export or a deploy. This is the same
portability story as Lovable/Bolt.new and the exportable half of Webflow,
which is honest company to be in, and it is a materially different position
from Wix, Durable, and Framer, which cannot make this claim at all.

**Hosting lives in the client's own accounts, not ours.** Every deploy
target, GitHub, Vercel, and (per the roadmap item just added) more to come,
is the customer's own credentials, encrypted at rest, never proxied through
Stardrive's own infrastructure as the permanent home. This is the opposite of
Duda's model, where client sites live on Duda's AWS hosting for as long as
the relationship lasts. An agency using Stardrive can walk away and the
client's site keeps running, because it was never actually on Stardrive's
servers to begin with.

**The database layer is vendor-neutral by construction, not by promise.**
The CMS's data layer talks to any libSQL-compatible endpoint (Turso is the
recommended hosted option, but a self-hosted libSQL server or local SQLite
file works identically). This was true in the code before it was true in the
marketing copy, which is the right order for a claim like this to be in.

**A hard completeness gate, not "generate and hope."** Every assembled site
is scanned for leftover placeholder copy before it is allowed to ship; a
template that still contains sample text fails the build and has to be
regenerated. This is specific to the "done-for-you agency site" problem and
isn't something a general-purpose AI app builder (v0, Lovable, Bolt.new) or a
DIY builder (Wix, Squarespace) has any reason to build, because their job
ends at "generate something," not "guarantee it's finished."

**Built for running many client projects, not one project.** Multi-tenant
accounts, private per-account template and site libraries, and per-build
metering are the actual product, not a feature bolted onto a single-site
tool. Duda is the only name on this list built around the same premise; the
difference is that Duda centralizes hosting on its own infrastructure and
Stardrive does not.

## Where the honest gaps are

**One-click deploy is currently Vercel-only.** GitHub push already covers
"any host" in the sense that a repo can be connected to Vercel, Netlify,
Cloudflare, or anywhere else, but that is a two-step path (push, then
connect), not a single click. Widening one-click publishing to more hosts is
a real, tracked roadmap item, not a solved problem yet.

**Image storage in the CMS is Vercel-specific today.** Photo uploads through
the CMS use Vercel Blob. A CMS site hosted somewhere other than Vercel will
have a broken upload feature until this gets a vendor-neutral alternative,
the same way the database did.

**Duda has a larger, more mature ecosystem.** More built-in apps, SEO
tooling, and a bigger established agency customer base. Stardrive is newer
and smaller; that is simply true and worth remembering when talking to a
prospect who has used Duda for years.

**v0, Lovable, and Bolt.new have far more general-purpose coding power** and
much larger teams and funding behind them. If someone wants to build an
arbitrary web app rather than a marketing/business website for a client,
those tools are a better fit than Stardrive, and pretending otherwise would
not survive a real side-by-side.

**Unproven at scale.** As of this writing, Stardrive has not yet been used
end to end by an outside licensee. The completeness gate, the copy pipeline,
and the QA battery have all been verified in this repo's own tests, but "one
friendly beta agency building a real site with zero hand-holding" (roadmap
M4) has not happened yet. That is the real proof still owed.

## The honest one-line pitch

Stardrive is for an agency or freelancer who wants to hand a client a
finished, complete website that the client actually owns, hosted on
infrastructure the client controls, without redoing the same manual build
process from scratch for every new client. Wix/Squarespace/Durable/Framer
can't hand over ownership at all. Webflow can hand over the static half.
10Web can hand over WordPress, with real migration friction. Duda gets the
agency workflow right but keeps hosting centralized. v0/Lovable/Bolt.new get
portability right but are general-purpose tools, not a done-for-you agency
pipeline. Stardrive is the only one of these trying to be honest about all
three at once, and the "unproven at scale" line above is the real cost of
that ambition right now.
