/**
 * The client handoff: what a licensee gives the person who paid for the site.
 *
 * Everything else Stardrive exports is for a developer. This is for a
 * hairdresser. It answers the four questions every client actually asks after
 * launch, in the order they ask them: where is my site, how do I sign in, what
 * can I change myself, and who do I call when something breaks.
 *
 * Deliberate choices:
 *  - The password is shown ONCE, in the document, in full. A handoff that says
 *    "ask your developer for the password" is not a handoff.
 *  - What the client can edit is derived from the modules actually installed,
 *    so it never promises a Menu tab to a site with no menu.
 *  - It is a self-contained HTML file with no external anything, so it prints,
 *    emails, and still opens in five years.
 */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * What each module gives the client, in their words. Keyed by module so the
 * guide lists only what is really installed. `panel` is the tab label they
 * will actually see in the dashboard, which is what makes this findable.
 */
export const MODULE_GUIDE = {
  'd4-cms-core': [
    { panel: 'Pages', can: 'Edit the words on your home, about and contact pages.' },
    { panel: 'Inbox', can: 'Read the messages people send through your contact form.' },
  ],
  'd4-careers-portal': [{ panel: 'Careers', can: 'Post a job, edit one, or take it down when the role is filled.' }],
  'd4-catalog': [{ panel: 'Catalog', can: 'Add products or services, with photos, prices and details.' }],
  'd4-gallery-editor': [{ panel: 'Galleries', can: 'Upload photos, reorder them, and write the descriptions screen readers use.' }],
  'd4-insights-blog': [{ panel: 'Articles', can: 'Write and publish articles, with a cover image.' }],
  'd4-testimonials': [{ panel: 'Testimonials', can: 'Add customer reviews as they come in, with an optional star rating.' }],
  'd4-team': [{ panel: 'Team', can: 'Add or remove staff, change job titles and biographies, and reorder people.' }],
  'd4-locations': [{ panel: 'Locations', can: 'Change your address, phone number and opening hours. Do this before a bank holiday, not after.' }],
  'd4-booking': [{ panel: 'Bookings', can: 'See your diary, confirm or cancel appointments, change your services and prices, and set the hours you work.' }],
  'd4-events': [{ panel: 'Events', can: 'Add what is coming up. Past events move into an archive on their own.' }],
  'd4-menu': [{ panel: 'Menus', can: 'Change dishes and prices, and mark anything that is off today without deleting it.' }],
  'd4-newsletter': [{ panel: 'Newsletter', can: 'See who has subscribed and download the list to send from your email tool.' }],
  'd4-payments': [{ panel: 'Payments', can: 'Add things people can pay for. The payment links come from your own Stripe account.' }],
  'd4-legal': [{ panel: 'Legal pages', can: 'Edit your privacy policy and terms. Each one stays hidden until you tick that you have reviewed it.' }],
};

/** The plain-English list of what this particular client can change. */
export function guideFor(modules = []) {
  const out = [];
  for (const mod of modules) for (const row of MODULE_GUIDE[mod] ?? []) out.push(row);
  return out;
}

/**
 * Things the client should know that are not about editing: where their data
 * lives, what needs their own account, what nobody has set up yet. Honest
 * gaps belong in a handoff, not in a support ticket three weeks later.
 */
export function notesFor({ modules = [], missingEnv = [], domain = null, hasEmail = false, hasDatabase = true }) {
  const notes = [];
  if (!domain) {
    notes.push('This site is live on its hosting address. If you have your own web address, it can be pointed here at any time.');
  }
  if (!hasEmail) {
    notes.push('Email delivery is not switched on yet. Messages sent through your website are SAVED and visible in your dashboard Inbox, but no notification is emailed to you, so check the Inbox regularly until this is set up.');
  }
  if (modules.includes('d4-payments')) {
    notes.push('Payments go straight into your own Stripe account. Stardrive and your web developer never hold your money, and refunds are handled in Stripe.');
  }
  if (modules.includes('d4-legal')) {
    notes.push('Your privacy policy and terms are drafts to work from, not finished legal documents, and they stay hidden from visitors until you tick that you have reviewed them. Have them checked by someone qualified first.');
  }
  if (modules.includes('d4-booking')) {
    notes.push('Check your working hours in the Bookings tab before you share the booking page. Customers can only book times you have marked as working.');
  }
  for (const item of missingEnv) {
    // The group name, since image storage has two valid answers and the gap is
    // reported once rather than once per variable.
    if (item.name === 'imageStorage' || item.name === 'BLOB_READ_WRITE_TOKEN') {
      notes.push('Permanent storage for uploaded images is not set up yet. Until it is, your site will refuse new photo uploads rather than accept them and lose them later. Ask whoever built your site to finish this.');
    }
  }
  // The counterpart nobody had written. If the CMS has no database behind it,
  // the client's edits go to a file on the server that the next update wipes,
  // and they would have no way of knowing until their work vanished.
  if (modules.includes('d4-cms-core') && !hasDatabase) {
    notes.push('IMPORTANT: this site does not yet have a permanent database, so changes you make in your dashboard may be lost the next time the site is updated. Do not rely on it for anything you cannot retype until whoever built your site has connected one.');
  }
  return notes;
}

/** The handoff as a self-contained HTML page: printable, emailable, offline. */
export function renderHandoffHtml({
  siteName,
  siteUrl,
  adminUrl,
  password,
  guide,
  notes,
  preparedBy = null,
  supportEmail = null,
  date = new Date().toISOString().slice(0, 10),
}) {
  const rows = guide.map((g) => `      <tr><th scope="row">${esc(g.panel)}</th><td>${esc(g.can)}</td></tr>`).join('\n');
  const noteItems = notes.map((n) => `      <li>${esc(n)}</li>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(siteName)} — your website</title>
<style>
  :root { --ink:#15202b; --muted:#5b6b7a; --rule:#d7dee5; --accent:#0b6ea8; --warn:#8a5a12; --warnbg:#fdf6e8; }
  * { box-sizing:border-box; }
  body { margin:0; padding:2.5rem 1.5rem 4rem; font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:var(--ink); background:#fff; }
  main { max-width:44rem; margin:0 auto; }
  h1 { font-size:1.9rem; line-height:1.2; margin:0 0 .35rem; letter-spacing:-.02em; }
  h2 { font-size:1.15rem; margin:2.5rem 0 .75rem; letter-spacing:-.01em; }
  p, li { color:var(--ink); }
  .sub { color:var(--muted); margin:0 0 2rem; }
  .card { border:1px solid var(--rule); border-radius:6px; padding:1.25rem 1.35rem; margin:1rem 0; }
  .cred { display:grid; grid-template-columns:auto 1fr; gap:.5rem 1.25rem; align-items:baseline; }
  .cred dt { color:var(--muted); font-size:.85rem; }
  .cred dd { margin:0; font-family:ui-monospace,"Cascadia Mono",Consolas,monospace; font-size:1rem; word-break:break-all; }
  .pw { font-size:1.25rem; letter-spacing:.04em; font-weight:600; }
  table { border-collapse:collapse; width:100%; margin-top:.5rem; }
  th, td { text-align:left; padding:.65rem .5rem; border-bottom:1px solid var(--rule); vertical-align:top; font-size:.95rem; }
  th[scope=row] { width:11rem; color:var(--accent); font-weight:600; }
  .warn { background:var(--warnbg); border:1px solid #e8d5ab; border-radius:6px; padding:1rem 1.25rem; }
  .warn h2 { margin-top:0; color:var(--warn); font-size:1rem; }
  ul { padding-left:1.15rem; }
  li { margin:.4rem 0; }
  footer { margin-top:3rem; padding-top:1.25rem; border-top:1px solid var(--rule); color:var(--muted); font-size:.85rem; }
  a { color:var(--accent); }
  @media print { body { padding:0; } .card, .warn { break-inside:avoid; } }
</style>
</head>
<body>
<main>
  <h1>${esc(siteName)}</h1>
  <p class="sub">Everything you need to look after your new website. Keep this somewhere safe: it contains your password.</p>

  <h2>Your website</h2>
  <div class="card">
    <dl class="cred">
      <dt>Website</dt><dd><a href="${esc(siteUrl)}">${esc(siteUrl)}</a></dd>
      <dt>Sign in at</dt><dd><a href="${esc(adminUrl)}">${esc(adminUrl)}</a></dd>
      <dt>Password</dt><dd class="pw">${esc(password)}</dd>
    </dl>
  </div>
  <p>There is no username. Go to the sign-in address, enter the password above, and you are in.</p>

  <h2>What you can change yourself</h2>
  <p>Once you are signed in you will see these sections. Changes appear on your website straight away.</p>
  <table>
    <tbody>
${rows || '      <tr><td colspan="2">Your website is a fixed design with no self-service editing. Contact whoever built it for changes.</td></tr>'}
    </tbody>
  </table>

${notes.length ? `  <div class="warn">
    <h2>Worth knowing</h2>
    <ul>
${noteItems}
    </ul>
  </div>` : ''}

  <h2>If something goes wrong</h2>
  <p>${supportEmail
    ? `Email <a href="mailto:${esc(supportEmail)}">${esc(supportEmail)}</a>.`
    : 'Contact whoever built your website.'} Your website and its content belong to you. It is an ordinary modern website, so any competent web developer can take it on if you ever move.</p>

  <footer>
    Prepared ${esc(date)}${preparedBy ? ` by ${esc(preparedBy)}` : ''}. Built with Stardrive.
  </footer>
</main>
</body>
</html>
`;
}
