/**
 * The going-live guide, as data.
 *
 * This exists so a licensee never has to open a git repository to learn how
 * their own tool works. It is served at GET /v1/guide/deploy and rendered in
 * the Workbench, right beside the buttons it describes.
 *
 * Crucially it is DERIVED, not written twice. The environment section is built
 * from the same MANAGED/SUPPLIED definitions the deploy path actually uses, and
 * the host list is the same one that goes into every site's DEPLOY.md. A guide
 * maintained separately from the code it documents is a guide that is wrong
 * within a month, and wrong documentation is worse than none: it costs the
 * reader the time to follow it plus the time to discover it lied.
 */
import { MANAGED, SUPPLIED, SUPPLIED_GROUPS } from './site-env.mjs';

/**
 * Where a Stardrive site can go. `how` is the mechanism, which is what decides
 * whether it needs a token from the licensee, a git push, or nothing at all.
 */
export const HOSTS = [
  {
    name: 'Vercel', how: 'direct',
    note: 'Publish straight from Stardrive. Settings are pushed for you, and a custom domain is attached automatically.',
  },
  {
    name: 'Netlify', how: 'direct',
    note: 'Publish straight from Stardrive. Same as Vercel: settings pushed, domain attached.',
  },
  { name: 'Cloudflare Pages', how: 'git', note: 'Connect the repository. Build command npm run build.' },
  { name: 'Render', how: 'git', note: 'Connect the repository, or deploy the included Dockerfile.' },
  { name: 'Railway', how: 'git', note: 'Connect the repository, or deploy the included Dockerfile.' },
  { name: 'AWS Amplify', how: 'git', note: 'Connect the repository.' },
  { name: 'DigitalOcean App Platform', how: 'git', note: 'Connect the repository, or deploy the Dockerfile.' },
  { name: 'Fly.io', how: 'container', note: 'Deploy the included Dockerfile.' },
  { name: 'Google Cloud Run', how: 'container', note: 'Deploy the included Dockerfile.' },
  { name: 'Coolify or Dokku', how: 'container', note: 'Self-hosted. Deploy the Dockerfile on your own server.' },
  { name: 'Any VPS', how: 'server', note: 'npm install, npm run build, npm start. Put a proxy in front for HTTPS.' },
];

export const HOW_LABELS = {
  direct: 'Stardrive publishes for you',
  git: 'Connect a git repository',
  container: 'Deploy the included Dockerfile',
  server: 'Run it yourself',
};

/**
 * The environment section, built from the live definitions. `managed` is what
 * the licensee never has to think about, which is most of it, and saying so
 * plainly is half the value of this page.
 */
export function environmentGuide() {
  // Grouped requirements are listed ONCE with their alternatives, not once per
  // variable. Image storage has two valid answers depending on the host, and
  // spelling out six variables here would undo the whole point of grouping
  // them in the settings panel.
  const seen = new Set();
  const supplied = [];
  for (const [name, v] of Object.entries(SUPPLIED)) {
    if (v.group) {
      if (seen.has(v.group)) continue;
      seen.add(v.group);
      const group = SUPPLIED_GROUPS[v.group];
      supplied.push({
        name: v.group,
        label: group.label,
        why: group.why,
        secret: false,
        oneOf: group.options.map((o) => ({ label: o.label, vars: o.vars })),
        where: group.options.map((o) => o.label).join(', or '),
      });
      continue;
    }
    supplied.push({ name, label: v.label, where: v.where, why: v.why, secret: Boolean(v.secret) });
  }
  return {
    managed: Object.entries(MANAGED).map(([name, why]) => ({ name, why })),
    supplied,
  };
}

/** Questions a licensee will otherwise ask support, answered once, here. */
export const FAQ = [
  {
    q: 'Do I need a Stripe key for a client site?',
    a: 'No. The payments module uses Stripe Payment Links, which your client creates in their own Stripe dashboard and you paste in. No API key, no webhook, and no card details ever touch the website. Money goes straight to their Stripe account.',
  },
  {
    q: 'Where do the API keys actually go?',
    a: 'Into the host, as environment variables, and Stardrive puts them there for you when you publish to Vercel or Netlify. For any other host, use Download .env on the site and paste the contents into that host\'s environment variables screen. You never edit code to set a key.',
  },
  {
    q: 'What happens if I skip the Resend key?',
    a: 'The site still publishes and still works. Messages from the contact form, job applications and booking requests are all SAVED and visible in the client\'s dashboard Inbox. Nothing is emailed to anyone, so the client has to check the Inbox. The handoff document tells them that in plain English.',
  },
  {
    q: 'What is the admin password and where does it come from?',
    a: 'Stardrive generates one per site and includes it in the client handoff. It stays the same unless you change it, so a client who wrote it down is never locked out. Use New password when a site changes hands, then publish again to make it live.',
  },
  {
    q: 'Can I host a site on ordinary shared hosting or S3?',
    a: 'Only if it has no admin area and no forms. A site with either is a real application rather than a folder of files, so it needs somewhere that runs Node. Every host listed on this page does.',
  },
  {
    q: 'Does my client depend on Stardrive continuing to exist?',
    a: 'No, and this is deliberate. What you deliver is ordinary Next.js code. Export it, push it to their own repository, deploy it anywhere on this page. Their content lives in their database, not in the code. Nothing here can hold a site hostage.',
  },
  {
    q: 'Does the client need a database?',
    a: 'Only if the site has an admin area, which most do. Connect one once in Hosting and every site you build reuses it, or connect a separate one per client. Any libSQL-compatible endpoint works; Turso is the easiest hosted option and has a free tier.',
  },
];

/** The whole guide, for GET /v1/guide/deploy. */
export function deployGuide() {
  return {
    environment: environmentGuide(),
    hosts: HOSTS,
    howLabels: HOW_LABELS,
    faq: FAQ,
    // The constraint that most often surprises someone, stated once, up top.
    constraint: 'A site with an admin area or any form is an application, not a folder of files, so it needs a host that runs Node. That rules out plain S3, GitHub Pages and basic shared hosting.',
    handoff: {
      what: 'A printable page for your client: their web address, how to sign in, their password in full, what they can change themselves, and anything still worth knowing.',
      how: 'Open any finished site, scroll to Hand over to your client, and choose Preview handoff to read it first or Download to save it. Send it however you normally send things to that client.',
      note: 'It shows the admin password in full, so treat the file like a password. If a site changes hands later, use New password and publish again.',
    },
    steps: [
      { title: 'Build the site', detail: 'Answer the essentials, add photos, and build. Nothing leaves Stardrive until you publish.' },
      { title: 'Add your keys', detail: 'On the site, open Site settings and add anything only you have, such as your Resend key. Once per site, reused on every publish after that.' },
      { title: 'Publish', detail: 'Publish to Vercel or Netlify and every setting goes with it. For any other host, use Download .env and paste it in there.' },
      { title: 'Point the domain', detail: 'Add your client\'s domain in the same panel. Stardrive shows exactly which DNS records to set, and never invents values for a host it cannot see.' },
      { title: 'Hand it over', detail: 'Download the handoff page and send it to your client. That is the job finished.' },
    ],
  };
}
