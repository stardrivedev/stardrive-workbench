/**
 * Transactional email via Resend — DORMANT until RESEND_API_KEY is set.
 * Used for the signup welcome and for lead notifications. When unconfigured
 * every call is a safe no-op, so signup and the request-access form work
 * without email in dev/beta. Never throws (callers fire-and-forget).
 *
 * Env: RESEND_API_KEY, STARDRIVE_EMAIL_FROM (default onboarding@stardrive.dev),
 *      STARDRIVE_LEADS_TO (where request-access notifications go).
 */
export function createEmail() {
  const configured = () => Boolean(process.env.RESEND_API_KEY);
  const from = () => process.env.STARDRIVE_EMAIL_FROM || 'Stardrive <onboarding@stardrive.dev>';

  async function send({ to, subject, text, html, replyTo }) {
    if (!configured()) return { sent: false, reason: 'email_unconfigured' };
    if (!to) return { sent: false, reason: 'no_recipient' };
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: from(), to, subject, ...(html ? { html } : {}), ...(text ? { text } : {}), ...(replyTo ? { reply_to: replyTo } : {}) }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); return { sent: false, reason: d.message || `status ${res.status}` }; }
      return { sent: true };
    } catch (e) {
      return { sent: false, reason: e.message };
    }
  }

  const welcome = (account) => send({
    to: account.email,
    subject: 'Welcome to Stardrive',
    text: `Your Stardrive account is ready.\n\nYour first API key was created in the Workbench — it's the license your scripts use. Sign in at the Workbench to generate templates, assemble sites, and connect your own hosting.\n\nReply to this email any time; we read every one.`,
  });

  const leadNotify = (lead) => send({
    to: process.env.STARDRIVE_LEADS_TO || from().replace(/.*<([^>]+)>.*/, '$1'),
    replyTo: lead.email,
    subject: `Stardrive access request: ${lead.name}${lead.company ? ` (${lead.company})` : ''}`,
    text: `${lead.name} <${lead.email}> requested access.\n\nCompany: ${lead.company || '—'}\n\n${lead.message || '(no message)'}`,
  });

  return { configured, send, welcome, leadNotify };
}
