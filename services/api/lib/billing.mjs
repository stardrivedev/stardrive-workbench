/**
 * Billing — the plan model plus a Stripe-ready checkout seam that stays
 * DORMANT until credentials are set (STRIPE_SECRET_KEY). Same pattern as
 * the LLM seams: everything works and tests pass without the key; the real
 * Stripe calls light up the moment it is present, so the numbers can be
 * decided from real usage before anything is charged.
 *
 * The meter that matters is sites assembled (already counted per key in
 * auth.meter). Billing aggregates a whole account's counters so a plan can
 * price against real volume once tiers are chosen.
 */
const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

export const PLANS = {
  beta: { label: 'Private beta', priceUsd: 0, includedAssemblies: null, note: 'Free while we set pricing with founding licensees.' },
  studio: { label: 'Studio', priceUsd: null, includedAssemblies: null, note: 'Pricing TBD with beta data.' },
};

export function createBilling(accounts) {
  const configured = () => Boolean(process.env.STRIPE_SECRET_KEY);

  /** Aggregate this month's counters across all of an account's keys. */
  function usageSummary(account, listKeys, usageFor, store) {
    let period = null;
    const totals = {};
    for (const k of listKeys(store, account.id)) {
      const u = usageFor(k.id);
      period = period || u.period;
      for (const [name, n] of Object.entries(u.counters)) totals[name] = (totals[name] || 0) + n;
    }
    return { period, totals };
  }

  function summary(account, usage) {
    return {
      plan: account.plan,
      planLabel: PLANS[account.plan]?.label ?? account.plan,
      checkoutConfigured: configured(),
      currency: 'usd',
      usage,
    };
  }

  /**
   * Create a Stripe Checkout session. Dormant (501) until STRIPE_SECRET_KEY
   * is set; when set, this creates a real subscription checkout. Untested
   * until a live test key is added — by design, per the owner's decision to
   * finalize pricing after measuring real cost.
   */
  async function createCheckout(account, { plan, successUrl, cancelUrl }) {
    if (!configured()) {
      throw httpError(501, 'billing_unconfigured',
        'Checkout is not enabled yet — Stripe is not configured. It activates the moment STRIPE_SECRET_KEY (and a plan price id) are set; pricing is being finalized from real usage first.');
    }
    const priceId = process.env[`STRIPE_PRICE_${String(plan || '').toUpperCase()}`];
    if (!priceId) throw httpError(422, 'unknown_plan', `No Stripe price configured for plan "${plan}".`);
    const form = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      client_reference_id: account.id,
      customer_email: account.email,
      success_url: successUrl || 'https://stardrive.dev/workbench/#/billing?checkout=success',
      cancel_url: cancelUrl || 'https://stardrive.dev/workbench/#/billing?checkout=cancel',
    });
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw httpError(502, 'stripe_error', data?.error?.message || `Stripe returned ${res.status}.`);
    return { url: data.url, id: data.id };
  }

  return { configured, summary, usageSummary, createCheckout };
}
