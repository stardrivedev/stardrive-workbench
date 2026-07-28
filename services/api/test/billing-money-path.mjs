/**
 * The money path, proven without a Stripe account and without spending a
 * cent: a stub Stripe stands in for the real one (STRIPE_API_BASE), and the
 * webhook half is pure crypto we can exercise exactly.
 *
 *   checkout: the request Stripe receives carries the account and plan, so
 *             the webhook can attribute the payment back to a licensee;
 *   webhook:  signature verified, REPLAYS refused, secret rotation handled,
 *             retries de-duplicated, and the plan flipped on subscribe,
 *             change, lapse, and cancel.
 *
 * What this does NOT cover is Stripe's own responses, which only a live test
 * key can settle. Everything on our side of that boundary is settled here.
 *
 * Run: node services/api/test/billing-money-path.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { VarStore } from '../lib/store.mjs';
import { createAccounts } from '../lib/accounts.mjs';
import { createBilling, PLANS } from '../lib/billing.mjs';

const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-money-'));
const store = new VarStore(varDir);
const accounts = createAccounts(store);

let failures = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(
  () => console.log(`  ok    ${name}`),
  (e) => { failures++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
);

const SECRET = 'whsec_test_secret';
process.env.STRIPE_WEBHOOK_SECRET = SECRET;

/** Sign a payload the way Stripe does. */
function sign(body, { secret = SECRET, at = Date.now(), extra = [] } = {}) {
  const t = Math.floor(at / 1000);
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return [`t=${t}`, `v1=${v1}`, ...extra].join(',');
}

const billing = createBilling(accounts, store);
const { account: acct } = accounts.signup({ email: 'payer@example.com', password: 'longenough' });

const event = (type, object, id) => JSON.stringify({ id: id || `evt_${crypto.randomUUID()}`, type, data: { object } });
const planOf = () => accounts.getAccount(acct.id).plan;

console.log('money path (stub Stripe, no spend):');

// ── Checkout ─────────────────────────────────────────────────────────────

await check('checkout sends Stripe everything needed to attribute the payment back', async () => {
  let received = null;
  const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      received = { url: req.url, auth: req.headers.authorization, form: new URLSearchParams(body) };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'cs_test_123', url: 'https://checkout.stripe.test/pay/cs_test_123' }));
    });
  });
  await new Promise((r) => stub.listen(0, r));
  const base = `http://localhost:${stub.address().port}`;

  process.env.STRIPE_SECRET_KEY = 'sk_test_stub';
  process.env.STRIPE_PRICE_STUDIO = 'price_studio_123';
  process.env.STRIPE_API_BASE = base;

  const out = await billing.createCheckout(acct, { plan: 'studio' });
  assert.strictEqual(out.url, 'https://checkout.stripe.test/pay/cs_test_123', 'the customer gets a checkout URL');

  assert.strictEqual(received.url, '/v1/checkout/sessions');
  assert.strictEqual(received.auth, 'Bearer sk_test_stub', 'authenticated with the secret key');
  assert.strictEqual(received.form.get('mode'), 'subscription');
  assert.strictEqual(received.form.get('line_items[0][price]'), 'price_studio_123', 'the plan maps to its price id');
  // The attribution that makes the webhook work at all:
  assert.strictEqual(received.form.get('client_reference_id'), acct.id);
  assert.strictEqual(received.form.get('metadata[account]'), acct.id);
  assert.strictEqual(received.form.get('metadata[plan]'), 'studio');
  assert.strictEqual(received.form.get('subscription_data[metadata][account]'), acct.id,
    'the SUBSCRIPTION carries it too, or a later cancel could not be traced to an account');
  assert.strictEqual(received.form.get('subscription_data[metadata][plan]'), 'studio');
  stub.close();
});

await check('checkout refuses a plan that is not for sale, or has no price configured', async () => {
  await assert.rejects(() => billing.createCheckout(acct, { plan: 'free' }), /not a purchasable plan/);
  await assert.rejects(() => billing.createCheckout(acct, { plan: 'nonsense' }), /not a purchasable plan/);
  await assert.rejects(() => billing.createCheckout(acct, { plan: 'agency' }), /No Stripe price configured/);
});

await check('with no key at all, checkout is dormant rather than broken', async () => {
  const keep = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  await assert.rejects(() => billing.createCheckout(acct, { plan: 'studio' }), /not enabled yet/);
  process.env.STRIPE_SECRET_KEY = keep;
});

// ── Webhook signature ────────────────────────────────────────────────────

await check('a correctly signed event is accepted and flips the plan', () => {
  const body = event('checkout.session.completed', { client_reference_id: acct.id, metadata: { account: acct.id, plan: 'studio' } });
  const out = billing.handleWebhook(body, sign(body));
  assert.strictEqual(out.action, 'plan set to studio');
  assert.strictEqual(planOf(), 'studio', 'the licensee is now on the plan they paid for');
});

await check('a forged or tampered event is refused', () => {
  const body = event('checkout.session.completed', { client_reference_id: acct.id, metadata: { account: acct.id, plan: 'agency' } });
  assert.throws(() => billing.handleWebhook(body, sign(body, { secret: 'whsec_wrong' })), /signature does not match/);
  // Right signature, but for different content: the body was altered in flight.
  const sig = sign(body);
  const tampered = body.replace('"studio"', '"agency"').replace('agency', 'agency');
  assert.throws(() => billing.handleWebhook(tampered + ' ', sig), /signature does not match/);
  assert.throws(() => billing.handleWebhook(body, 'garbage'), /malformed/);
  assert.throws(() => billing.handleWebhook(body, ''), /malformed/);
  assert.strictEqual(planOf(), 'studio', 'nothing changed');
});

await check('a REPLAYED event is refused, however valid its signature once was', () => {
  const body = event('checkout.session.completed', { client_reference_id: acct.id, metadata: { account: acct.id, plan: 'agency' } });
  // Perfectly signed, but yesterday. Without an age check this is a free upgrade.
  const old = sign(body, { at: Date.now() - 48 * 3600 * 1000 });
  assert.throws(() => billing.handleWebhook(body, old), /tolerance \(replay\?\)/);
  assert.strictEqual(planOf(), 'studio', 'no free upgrade');
  // A clock a little out of step is still fine.
  const skewed = sign(body, { at: Date.now() - 60 * 1000 });
  assert.doesNotThrow(() => billing.handleWebhook(body, skewed), 'a minute of clock skew is tolerated');
});

await check('during a secret rotation, several signatures are sent and any may match', () => {
  const body = event('checkout.session.completed', { client_reference_id: acct.id, metadata: { account: acct.id, plan: 'starter' } });
  const t = Math.floor(Date.now() / 1000);
  const good = crypto.createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
  const stale = crypto.createHmac('sha256', 'whsec_previous').update(`${t}.${body}`).digest('hex');
  // Stripe puts the OLD secret's signature first during rotation; taking only
  // the last (or only the first) breaks every rotation window.
  const header = `t=${t},v1=${stale},v1=${good}`;
  const out = billing.handleWebhook(body, header);
  assert.strictEqual(out.action, 'plan set to starter');
  assert.strictEqual(planOf(), 'starter');
});

// ── Retries and lifecycle ────────────────────────────────────────────────

await check('a retried event is answered from the first result, not acted on twice', () => {
  const id = 'evt_retry_me';
  const body = event('customer.subscription.deleted', { metadata: { account: acct.id } }, id);
  const first = billing.handleWebhook(body, sign(body));
  assert.strictEqual(first.action, 'plan reverted to free');
  assert.strictEqual(first.duplicate, undefined);
  assert.strictEqual(planOf(), 'free');

  // The licensee re-subscribes...
  const sub = event('checkout.session.completed', { client_reference_id: acct.id, metadata: { account: acct.id, plan: 'studio' } });
  billing.handleWebhook(sub, sign(sub));
  assert.strictEqual(planOf(), 'studio');

  // ...and Stripe retries the OLD cancellation. Without de-duplication this
  // downgrades someone who has just paid.
  const retry = billing.handleWebhook(body, sign(body));
  assert.strictEqual(retry.duplicate, true, 'recognised as already handled');
  assert.strictEqual(planOf(), 'studio', 'the paying customer keeps their plan');
});

await check('a plan change made in Stripe reaches us', () => {
  const body = event('customer.subscription.updated', { status: 'active', metadata: { account: acct.id, plan: 'starter' } });
  const out = billing.handleWebhook(body, sign(body));
  assert.strictEqual(out.action, 'plan set to starter');
  assert.strictEqual(planOf(), 'starter', 'a portal downgrade is honoured here too');
});

await check('a lapsed or unpaid subscription drops to free', () => {
  for (const status of ['unpaid', 'canceled', 'incomplete_expired']) {
    accounts.setPlan(acct.id, 'agency');
    const body = event('customer.subscription.updated', { status, metadata: { account: acct.id, plan: 'agency' } });
    const out = billing.handleWebhook(body, sign(body));
    assert.strictEqual(out.action, 'plan set to free', `${status} revokes the plan`);
    assert.strictEqual(planOf(), 'free');
  }
});

await check('events we do not care about, or cannot attribute, change nothing', () => {
  accounts.setPlan(acct.id, 'studio');
  const noise = event('invoice.payment_succeeded', { id: 'in_1' });
  assert.match(billing.handleWebhook(noise, sign(noise)).action, /ignored/);
  const orphan = event('customer.subscription.deleted', { metadata: {} });
  assert.match(billing.handleWebhook(orphan, sign(orphan)).action, /ignored/);
  const unknownPlan = event('checkout.session.completed', { client_reference_id: acct.id, metadata: { account: acct.id, plan: 'enterprise' } });
  assert.match(billing.handleWebhook(unknownPlan, sign(unknownPlan)).action, /ignored/);
  assert.strictEqual(planOf(), 'studio', 'still on the plan they paid for');
});

await check('with no webhook secret set, the endpoint is dormant rather than open', () => {
  const keep = process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const body = event('checkout.session.completed', { client_reference_id: acct.id, metadata: { account: acct.id, plan: 'agency' } });
  assert.throws(() => billing.handleWebhook(body, sign(body, { secret: keep })), /not enabled yet/,
    'an unconfigured deployment refuses rather than trusting anything sent to it');
  process.env.STRIPE_WEBHOOK_SECRET = keep;
});

// ── The gate the money actually buys ─────────────────────────────────────

await check('quota follows the plan, and overage needs both opt-in and a card', () => {
  accounts.setPlan(acct.id, 'starter');
  const spent = { totals: { 'studio.tokens': PLANS.starter.includedTokens + 1 } };
  const a = accounts.getAccount(acct.id);
  assert.throws(() => billing.checkStudioQuota(a, spent), /quota|used your included/i, 'out of tokens stops generation');

  accounts.setOverage(acct.id, true);
  const withOverage = accounts.getAccount(acct.id);
  assert.doesNotThrow(() => billing.checkStudioQuota(withOverage, spent), 'opted in, and Stripe configured, so it keeps going');

  const keep = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  assert.throws(() => billing.checkStudioQuota(withOverage, spent), /quota|used your included/i,
    'no card on file means no overage, whatever the toggle says');
  process.env.STRIPE_SECRET_KEY = keep;
});

delete process.env.STRIPE_API_BASE;
delete process.env.STRIPE_SECRET_KEY;
fs.rmSync(varDir, { recursive: true, force: true });
if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll money-path checks passed.');
process.exit(0);
