# Stardrive Workbench — Roadmap

Milestones toward a sellable 1.0. Estimates are focused build sessions, not
calendar time; Deneb4's own client work takes priority (its launch funds
this).

## M0 — Scaffold (DONE 2026-07-16)
Repo, vision, architecture, and the template-author contract committed.

## M1 — The field-mapping layer (~3–5 sessions)
The one genuinely new engineering piece: a declarative format a licensee
fills out once, mapping THEIR intake questionnaire's fields onto THEIR
template's build-config slots — replacing Deneb4's hardcoded Q-code parser
with a generic engine. Design goal: a non-engineer at an agency can author a
mapping. **Benefits Deneb4 immediately** (its own intake becomes a mapping
file instead of two hand-synced parsers), so build this inside the Deneb4
repo first and extract.

## M2 — Workbench MVP (~10–18 sessions)
Electron app: template library (d4 catalog bundled; import + validate
third-party templates against the manifest schema + contrast validator),
client-facts form (driven by M1), assemble, local preview, QA battery,
deploy with licensee-entered Vercel/Turso/GitHub tokens. Windows first
(the dev machine), macOS after.

## M3 — Sellable 1.0 (~8–15 sessions + external tasks)
- License activation (offline-friendly key file).
- Payments/merchant-of-record: Paddle or Lemon Squeezy (they handle sales
  tax — right-sized for a solo operation).
- Installer packaging + code signing: Windows Authenticode cert + Apple
  notarization (real cost + identity paperwork — owner task).
- Template-author docs polished for strangers; a worked example template.
- stardrive.dev marketing site — build it WITH the d4 engine (dogfood + demo).

## M4 — First licensees
One friendly beta agency building a real template against the contract with
zero hand-holding; fix everything that breaks. Only after that: wider sales,
and only after THAT: any hosted/SaaS variant (see the licensing feasibility
analysis in the Deneb4 planning artifacts — Model A validates demand before
Model B's infrastructure).

## Standing rules
- Nothing Deneb4-specific (pricing, clients, branding) ever enters the
  engine repos or this app.
- Every capability stays contract-driven (manifest / theme tokens / panel
  registry) — a hardcoded assumption today is porting work tomorrow.
