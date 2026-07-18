/**
 * Billing — plans, token quotas, opt-in overage, and a Stripe-ready
 * checkout/charge seam that stays DORMANT until credentials are set
 * (STRIPE_SECRET_KEY). Everything works and tests pass without the key;
 * real Stripe calls light up the moment it is present.
 *
 * The billable unit is a **token**: Template Studio generation consumes
 * model tokens (Stardrive's real marginal cost), so plans are sized in
 * tokens. Site assembly is deterministic (no model cost) and is included.
 *
 * Design rules baked into the tiers below:
 *   1. Every tier is margin-positive on included tokens, and overage is
 *      priced ABOVE the included effective rate (so "keep working" pays).
 *   2. Higher tiers are cheaper per token — both a lower effective included
 *      rate and a lower overage rate — so scaling up rewards the customer.
 *   3. Overage is opt-in and bills to the card on file, so a customer never
 *      hard-stops mid-project unless they choose to.
 *
 * Numbers are sane, profitable starting points to be tuned with beta data
 * and the chosen generation model (STARDRIVE_LLM_MODEL drives real cost).
 */
const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

// includedTokens sized so effective $/1k descends up the tiers; overagePer1kUsd
// descends too and always sits above the tier's effective included rate.
export const PLANS = {
  beta: {
    label: 'Beta', order: 0, hidden: true, priceUsd: 0,
    includedTokens: 5_000_000, includedAssemblies: null, overagePer1kUsd: null,
    blurb: 'Free while pricing is finalized with founding licensees.',
  },
  free: {
    label: 'Free', order: 1, priceUsd: 0,
    includedTokens: 250_000, includedAssemblies: 5, overagePer1kUsd: null,
    blurb: 'Kick the tires — no card required.',
  },
  starter: {
    label: 'Starter', order: 2, priceUsd: 39,
    includedTokens: 2_000_000, includedAssemblies: null, overagePer1kUsd: 0.030,
    blurb: 'Solo and freelance — a few sites a month.',
  },
  studio: {
    label: 'Studio', order: 3, priceUsd: 119, popular: true,
    includedTokens: 8_000_000, includedAssemblies: null, overagePer1kUsd: 0.022,
    blurb: 'A working studio shipping steadily.',
  },
  agency: {
    label: 'Agency', order: 4, priceUsd: 349,
    includedTokens: 30_000_000, includedAssemblies: null, overagePer1kUsd: 0.016,
    blurb: 'High volume, lowest per-token rate.',
  },
};

/** A token estimate for one typical template generation (for humanizing sizes). */
export const TOKENS_PER_GENERATION = 40_000;

function planOf(account) {
  return PLANS[account?.plan] || PLANS.beta;
}

/** Public plan catalog with derived per-token economics, cheapest tiers last. */
export function planCatalog() {
  return Object.entries(PLANS)
    .filter(([, p]) => !p.hidden)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([id, p]) => ({
      id,
      label: p.label,
      priceUsd: p.priceUsd,
      includedTokens: p.includedTokens,
      includedAssemblies: p.includedAssemblies,
      overagePer1kUsd: p.overagePer1kUsd,
      popular: Boolean(p.popular),
      blurb: p.blurb,
      approxGenerations: Math.round(p.includedTokens / TOKENS_PER_GENERATION),
      effectivePer1kUsd: p.priceUsd > 0 ? +(p.priceUsd / (p.includedTokens / 1000)).toFixed(4) : 0,
    }));
}

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

  /** Token quota picture for an account given its aggregated usage. */
  function quota(account, usage) {
    const plan = planOf(account);
    const usedTokens = usage?.totals?.['studio.tokens'] || 0;
    const usedAssemblies = usage?.totals?.['sites.assemble'] || 0;
    const remainingTokens = Math.max(0, plan.includedTokens - usedTokens);
    const over = usedTokens >= plan.includedTokens;
    const overageOffered = plan.overagePer1kUsd != null;
    const overageOn = Boolean(account.overageEnabled) && overageOffered;
    // Actually charging overage needs a card, i.e. Stripe configured.
    const overageActive = overageOn && configured();
    return {
      usedTokens, includedTokens: plan.includedTokens, remainingTokens, over,
      usedAssemblies, includedAssemblies: plan.includedAssemblies,
      overageOffered, overageEnabled: Boolean(account.overageEnabled), overageActive,
      overagePer1kUsd: plan.overagePer1kUsd,
    };
  }

  /** Gate a new Studio generation. Throws 402 when out of tokens and overage isn't active. */
  function checkStudioQuota(account, usage) {
    const q = quota(account, usage);
    if (!q.over || q.overageActive) return q;
    const plan = planOf(account);
    throw httpError(402, 'quota_exhausted', plan.overagePer1kUsd == null
      ? 'You have used your included template-generation tokens for this period. Upgrade your plan to keep generating.'
      : 'You have used your included tokens for this period. Turn on extra usage (billed to your card on file) or upgrade to keep generating.');
  }

  function summary(account, usage) {
    const plan = planOf(account);
    return {
      plan: account.plan,
      planLabel: plan.label,
      checkoutConfigured: configured(),
      currency: 'usd',
      usage,
      quota: quota(account, usage),
      plans: planCatalog(),
    };
  }

  /**
   * Create a Stripe Checkout subscription session. Dormant (501) until
   * STRIPE_SECRET_KEY + a per-plan price id are set. Untested until a live
   * test key is added — by design (pricing is finalized from real usage).
   */
  async function createCheckout(account, { plan, successUrl, cancelUrl }) {
    if (!configured()) {
      throw httpError(501, 'billing_unconfigured',
        'Checkout is not enabled yet — Stripe is not configured. It activates the moment STRIPE_SECRET_KEY (and a plan price id) are set; pricing is being finalized from real usage first.');
    }
    if (!PLANS[plan] || PLANS[plan].priceUsd <= 0) throw httpError(422, 'unknown_plan', `"${plan}" is not a purchasable plan.`);
    const priceId = process.env[`STRIPE_PRICE_${String(plan).toUpperCase()}`];
    if (!priceId) throw httpError(422, 'plan_unpriced', `No Stripe price configured for plan "${plan}".`);
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
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw httpError(502, 'stripe_error', data?.error?.message || `Stripe returned ${res.status}.`);
    return { url: data.url, id: data.id };
  }

  return { configured, summary, usageSummary, quota, checkStudioQuota, createCheckout };
}
