/**
 * Billing — plans, token quotas, opt-in overage, and a Stripe-ready
 * checkout/charge seam that stays DORMANT until credentials are set
 * (STRIPE_SECRET_KEY). Everything works and tests pass without the key;
 * real Stripe calls light up the moment it is present.
 *
 * The billable unit is a **token**, but the unit customers feel is a
 * **finished site**: one build = a bespoke template design (~18k tokens) plus
 * that client's written copy (~2k), about 20k tokens and roughly $0.59 of real
 * model cost. Agencies build a fresh design per client (little reuse), so the
 * recurring unit is the whole build, not an amortized design. Plans are sized
 * in builds and priced per build, with tokens as the metered substrate.
 *
 * Design rules baked into the tiers below:
 *   1. Every tier is margin-positive per build (well above the ~$0.59 cost),
 *      and overage is priced ABOVE the included effective rate (so "keep
 *      building" always pays).
 *   2. Higher tiers are cheaper per build — both a lower effective included
 *      rate and a lower overage rate — so scaling up rewards the customer.
 *   3. Overage is opt-in and bills to the card on file, so a customer never
 *      hard-stops mid-project unless they choose to.
 *
 * Numbers are sane, profitable starting points to be tuned with beta data
 * and the chosen generation model (STARDRIVE_LLM_MODEL drives real cost).
 */
import crypto from 'node:crypto';

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

// includedTokens sized so effective $/build descends up the tiers; overage
// descends too and always sits above the tier's effective included rate.
export const PLANS = {
  beta: {
    label: 'Beta', order: 0, hidden: true, priceUsd: 0,
    includedTokens: 5_000_000, includedAssemblies: null, overagePer1kUsd: null,
    batch: true, // operator/testing plan gets every capability
    blurb: 'Free while pricing is finalized with founding licensees.',
  },
  free: {
    label: 'Free', order: 1, priceUsd: 0,
    includedTokens: 60_000, includedAssemblies: null, overagePer1kUsd: null,
    blurb: 'Kick the tires: three finished sites, no card required.',
  },
  starter: {
    label: 'Starter', order: 2, priceUsd: 39,
    includedTokens: 400_000, includedAssemblies: null, overagePer1kUsd: 0.125,
    blurb: 'Solo and freelance, around twenty finished sites a month.',
  },
  studio: {
    label: 'Studio', order: 3, priceUsd: 99, popular: true,
    includedTokens: 1_200_000, includedAssemblies: null, overagePer1kUsd: 0.100,
    blurb: 'A working studio building finished sites at scale.',
  },
  agency: {
    label: 'Agency', order: 4, priceUsd: 299,
    includedTokens: 5_000_000, includedAssemblies: null, overagePer1kUsd: 0.075,
    // Batch Building: queue many builds, run them overnight on the provider's
    // Batch API, come back to finished sites. The Agency tier's flagship perk.
    batch: true,
    blurb: 'High volume, the lowest per-site rate, overnight Batch Building.',
  },
};

// Measured token costs (2026-07): a Studio TEMPLATE design runs ~18k tokens on
// gpt-5.6-sol; a client SITE's copy runs ~2k on gpt-5.5. Agencies build a fresh
// design per client (little reuse), so the recurring unit is the whole BUILD
// (design + copy, ~20k tokens, ~$0.59 real cost), and plans are sized in builds.
export const TOKENS_PER_GENERATION = 18_000; // one bespoke template design
export const TOKENS_PER_SITE = 2_000;        // one client site's written copy
export const TOKENS_PER_BUILD = TOKENS_PER_GENERATION + TOKENS_PER_SITE; // one finished site

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
      batch: Boolean(p.batch),
      blurb: p.blurb,
      approxDesigns: Math.round(p.includedTokens / TOKENS_PER_GENERATION),
      approxSites: Math.round(p.includedTokens / TOKENS_PER_SITE),
      approxBuilds: Math.round(p.includedTokens / TOKENS_PER_BUILD),
      effectivePer1kUsd: p.priceUsd > 0 ? +(p.priceUsd / (p.includedTokens / 1000)).toFixed(4) : 0,
      effectivePerBuildUsd: p.priceUsd > 0 ? +(p.priceUsd / (p.includedTokens / TOKENS_PER_BUILD)).toFixed(2) : 0,
    }));
}

/** Does this account's plan include a named capability flag? (Generic helper;
 *  no plan capabilities are gated at present.) */
export function planAllows(account, feature) {
  return Boolean(planOf(account)[feature]);
}

/** How old a signed webhook may be. Stripe's own default; the point is that
 *  a captured event cannot be replayed tomorrow for a free upgrade. */
const WEBHOOK_TOLERANCE_SEC = Number(process.env.STRIPE_WEBHOOK_TOLERANCE_SEC) || 300;
/** Overridable so the money path can be exercised against a stub instead of
 *  a real account. Same idea as STARDRIVE_PLAYWRIGHT for the QA browser. */
const stripeBase = () => (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/$/, '');

/** `store` is optional: without it, webhook de-duplication is skipped rather
 *  than failing, so a caller that only wants plan maths need not supply one. */
export function createBilling(accounts, store = null) {
  const configured = () => Boolean(process.env.STRIPE_SECRET_KEY);
  const seenPath = (eventId) => `billing/events/${String(eventId).replace(/[^a-zA-Z0-9_-]/g, '')}.json`;

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
      batch: Boolean(plan.batch), // Batch Building available on this plan?
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
        'Checkout is not enabled yet: Stripe is not configured. It activates the moment STRIPE_SECRET_KEY (and a plan price id) are set; pricing is being finalized from real usage first.');
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
      'metadata[account]': account.id,
      'metadata[plan]': plan,
      'subscription_data[metadata][account]': account.id,
      'subscription_data[metadata][plan]': plan,
      success_url: successUrl || 'https://stardrive.dev/workbench/#/billing?checkout=success',
      cancel_url: cancelUrl || 'https://stardrive.dev/workbench/#/billing?checkout=cancel',
    });
    const res = await fetch(`${stripeBase()}/v1/checkout/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw httpError(502, 'stripe_error', data?.error?.message || `Stripe returned ${res.status}.`);
    return { url: data.url, id: data.id };
  }

  /**
   * Verify a Stripe webhook signature (scheme: `t=<unix>,v1=<hmac-sha256>`).
   *
   * Two details that matter and are easy to get wrong:
   *  - The timestamp is signed for a REASON: without an age check, anyone who
   *    ever captures one valid webhook can replay it forever. A replayed
   *    `checkout.session.completed` is a free plan upgrade.
   *  - During a secret rotation Stripe sends SEVERAL `v1=` signatures in one
   *    header, and the rule is "accept if ANY matches". Parsing the header
   *    into an object keeps only the last one, which breaks every rotation.
   */
  function verifySignature(rawBody, sigHeader, secret, { toleranceSec = WEBHOOK_TOLERANCE_SEC, now = Date.now() } = {}) {
    const pairs = String(sigHeader || '').split(',').map((kv) => {
      const i = kv.indexOf('=');
      return i === -1 ? null : [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }).filter(Boolean);
    const t = pairs.find(([k]) => k === 't')?.[1];
    const signatures = pairs.filter(([k]) => k === 'v1').map(([, v]) => v);
    if (!t || !signatures.length) return { ok: false, reason: 'malformed signature header' };

    const ageSec = Math.abs(now / 1000 - Number(t));
    if (!Number.isFinite(ageSec)) return { ok: false, reason: 'malformed timestamp' };
    if (toleranceSec > 0 && ageSec > toleranceSec) {
      return { ok: false, reason: `timestamp outside the ${toleranceSec}s tolerance (replay?)` };
    }

    const expected = Buffer.from(crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'));
    const matched = signatures.some((sig) => {
      const given = Buffer.from(sig);
      return given.length === expected.length && crypto.timingSafeEqual(given, expected);
    });
    return matched ? { ok: true } : { ok: false, reason: 'signature does not match' };
  }

  /**
   * Handle a Stripe webhook: flip the account's plan on subscribe, revert to
   * free on cancel. Dormant (501) until STRIPE_WEBHOOK_SECRET is set.
   */
  function handleWebhook(rawBody, sigHeader) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw httpError(501, 'billing_unconfigured', 'Stripe webhooks are not enabled yet (STRIPE_WEBHOOK_SECRET unset).');
    const sig = verifySignature(rawBody, sigHeader, secret);
    if (!sig.ok) throw httpError(400, 'bad_signature', `Invalid Stripe signature: ${sig.reason}.`);
    let event;
    try { event = JSON.parse(rawBody); } catch { throw httpError(400, 'bad_json', 'Webhook body is not JSON.'); }

    // Stripe retries until it gets a 2xx, so the same event WILL arrive more
    // than once. Answer the retry with what happened the first time instead
    // of acting twice: a duplicate `subscription.deleted` landing after a
    // re-subscribe would otherwise downgrade someone who just paid.
    if (event.id && store) {
      const seen = store.readJson(seenPath(event.id));
      if (seen) return { ...seen, duplicate: true };
    }

    const result = applyEvent(event);
    if (event.id && store) store.writeJson(seenPath(event.id), { ...result, at: new Date().toISOString() });
    return result;
  }

  function applyEvent(event) {
    const obj = event?.data?.object || {};
    const planOfObject = () => {
      const p = obj.metadata?.plan;
      return p && PLANS[p] ? p : null;
    };

    if (event.type === 'checkout.session.completed') {
      const accountId = obj.client_reference_id || obj.metadata?.account;
      const plan = planOfObject();
      if (accountId && plan && accounts.setPlan(accountId, plan)) {
        return { received: true, action: `plan set to ${plan}`, account: accountId };
      }
      return { received: true, action: 'ignored (missing account or plan)' };
    }

    // A plan change made in Stripe (upgrade, downgrade, or a subscription
    // that lapsed into an unpaid state) has to reach us too, or someone can
    // downgrade in the portal and keep the higher tier here indefinitely.
    if (event.type === 'customer.subscription.updated') {
      const accountId = obj.metadata?.account;
      if (!accountId) return { received: true, action: 'ignored (no account metadata)' };
      const dead = ['canceled', 'unpaid', 'incomplete_expired'].includes(obj.status);
      const plan = dead ? 'free' : planOfObject();
      if (!plan) return { received: true, action: `ignored (no plan in metadata, status ${obj.status})` };
      if (accounts.setPlan(accountId, plan)) {
        return { received: true, action: `plan set to ${plan}`, account: accountId };
      }
      return { received: true, action: 'ignored (unknown account)' };
    }

    if (event.type === 'customer.subscription.deleted') {
      const accountId = obj.metadata?.account;
      if (accountId && accounts.setPlan(accountId, 'free')) {
        return { received: true, action: 'plan reverted to free', account: accountId };
      }
      return { received: true, action: 'ignored (no account metadata)' };
    }
    return { received: true, action: `ignored (${event.type})` };
  }

  return { configured, summary, usageSummary, quota, checkStudioQuota, createCheckout, handleWebhook, verifySignature, planAllows };
}
