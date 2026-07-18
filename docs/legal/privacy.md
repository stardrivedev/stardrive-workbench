# Stardrive Privacy Policy — DRAFT

> **DRAFT for review by counsel. Not legal advice and not yet in force.**
> Plain-language description of what data Stardrive handles, so an attorney
> can finalize a compliant policy before launch. Do not publish as final.

## What we collect

- **Account data:** your email, a salted password hash, company (optional),
  plan, and billing status. We never store your password in the clear.
- **API keys:** stored only as SHA-256 hashes; the secret is shown once.
- **Your content:** templates, field mappings, intake answers, and uploaded
  assets you provide, plus the sites you assemble. Private to your account.
- **Hosting credentials:** Vercel/Turso/GitHub tokens you connect, encrypted
  at rest (AES-256-GCM) and used only to deploy your sites at your direction.
  Never displayed back to you or anyone.
- **Usage:** per-key metered counts (generations, tokens, assemblies) for
  billing. Failed calls are not counted.
- **Leads:** if you request access, the name, email, company, and message
  you submit.

## What we do NOT do

- We do not sell your data.
- We do not use your content to train models.
- The Template Studio runs on our model provider under our key; your prompts
  are sent to that provider to generate templates and are not used by us for
  any other purpose. [Confirm provider data terms with counsel.]

## Retention

Account and content data persist while your account is active. Transient
build artifacts are deleted after a grace period. You can export your sites
and request deletion of your account data.

## Sharing

We share data only with processors needed to run the service (e.g. our model
provider for generation, Stripe for payments, our email provider) under their
terms. The bundled d4 catalog is the only content shared across accounts;
your uploads are never shared with other customers.

## Your choices

Rotate/revoke keys, disconnect hosting credentials, toggle extra usage, and
request account deletion in the Workbench or by contacting us.

## Contact

[contact TBD]. This policy will be updated on notice before launch.
