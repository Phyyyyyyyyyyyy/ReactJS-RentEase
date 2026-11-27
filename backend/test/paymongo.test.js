import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { buildLedger, monthStart, tenanciesFor } from '../src/billing.js';
import { PayMongoGateway } from '../src/gcash.js';
import { addDays, nowIso, today } from '../src/lib/format.js';
import { makeApplication, makeProperty, makeUnit, makeUser, setup } from './helpers.js';

/**
 * PayMongo is replaced by a fake that speaks the same endpoints (create and retrieve a
 * checkout session), so these tests never touch the network.
 */
const WEBHOOK_SECRET = 'whsk_test_secret';
const SECRET_KEY = 'sk_test_abc123';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function fakePayMongo() {
  const sessions = new Map();
  const fake = {
    calls: [],
    failCreate: false,
    markPaid(id, amount) {
      sessions.get(id).payments.push({ id: `pay_${id}`, attributes: { status: 'paid', amount } });
    },
    fetchImpl: async (url, init) => {
      fake.calls.push({ url, method: init.method, headers: init.headers, body: init.body && JSON.parse(init.body) });
      if (init.method === 'POST' && url.endsWith('/v2/checkout_sessions')) {
        if (fake.failCreate) return json({ errors: [{ detail: 'Service unavailable' }] }, 503);
        const id = `cs_test_${sessions.size + 1}`;
        sessions.set(id, { payments: [] });
        return json({ data: { id, type: 'checkout_session', attributes: { checkout_url: `https://checkout.example/${id}` } } });
      }
      const match = url.match(/\/v2\/checkout_sessions\/(cs_\w+)$/);
      if (init.method === 'GET' && match && sessions.has(match[1])) {
        return json({ data: { id: match[1], type: 'checkout_session', attributes: { payments: sessions.get(match[1]).payments } } });
      }
      return json({ errors: [{ detail: 'Unexpected request' }] }, 400);
    },
  };
  return fake;
}

/** The Paymongo-Signature header PayMongo would send for this raw body. */
function signature(raw, { secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000), field = 'te' } = {}) {
  const digest = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return field === 'te' ? `t=${t},te=${digest},li=${'0'.repeat(64)}` : `t=${t},te=${'0'.repeat(64)},li=${digest}`;
}

const webhookBody = (sessionId, type = 'checkout_session.payment.paid') => JSON.stringify({
  data: { id: 'evt_1', type: 'event', attributes: { type, livemode: false, data: { id: sessionId, type: 'checkout_session', attributes: {} } } },
});

let env;
let db;
let client;
let fake;
let owner;
let tenant;
let tenancy;

beforeEach(async () => {
  fake = fakePayMongo();
  const gateway = new PayMongoGateway({ secretKey: SECRET_KEY, webhookSecret: WEBHOOK_SECRET, fetchImpl: fake.fetchImpl });
  env = await setup({ gateway });
  ({ db, client } = env);
  owner = await makeUser(db, 'owner', 'owner');
  tenant = await makeUser(db, 'tenant', 'tenant');
  const prop = await makeProperty(db, owner, { name: 'Lahug', address: 'A' });
  const unit = await makeUnit(db, prop, { name: '101', rent: 8000, status: 'occupied' });
  const start = monthStart(addDays(monthStart(today()), -1));
  tenancy = await makeApplication(db, tenant, unit, { status: 'approved', approved_at: `${start}T02:00:00.000Z` });
  await client.login(tenant);
});
afterEach(() => env.close());

const startCheckout = (amount = '8000') => client.post(`/payments/${tenancy.id}/checkout/`, { amount });
const paymentCount = async () => (await db.get('SELECT COUNT(*) AS n FROM payments')).n;
const balance = async () => (await buildLedger(db, (await tenanciesFor(db, { id: tenancy.id }))[0])).balance;
const postWebhook = (raw, header = signature(raw)) => {
  const headers = { 'Content-Type': 'application/json' };
  if (header) headers['Paymongo-Signature'] = header;
  return fetch(`${client.base}/api/payments/webhooks/paymongo/`, { method: 'POST', headers, body: raw });
};

describe('PayMongo checkout', () => {
  it('creates a hosted GCash checkout in centavos and sends the tenant to it', async () => {
    const started = await startCheckout();
    assert.equal(started.status, 201);
    assert.equal(started.json.sandbox, false);
    const code = started.json.checkout_id;

    const [create] = fake.calls.filter((c) => c.method === 'POST');
    assert.equal(create.headers.Authorization, `Basic ${Buffer.from(`${SECRET_KEY}:`).toString('base64')}`);
    const attributes = create.body.data.attributes;
    assert.deepEqual(attributes.line_items, [{ name: 'Rent payment', amount: 800000, currency: 'PHP', quantity: 1 }]);
    assert.deepEqual(attributes.payment_method_types, ['gcash']);
    assert.equal(attributes.reference_number, code);
    assert.match(attributes.success_url, new RegExp(`/payments/checkout/${code}\\?returned=1$`));

    const row = await db.get('SELECT * FROM gcash_checkouts WHERE id = ?', [code]);
    assert.deepEqual([row.provider, row.provider_checkout_id, row.provider_url],
      ['paymongo', 'cs_test_1', 'https://checkout.example/cs_test_1']);
  });

  it('pay returns PayMongo\'s page to redirect to, and records nothing yet', async () => {
    const code = (await startCheckout()).json.checkout_id;
    const paid = await client.post(`/payments/checkout/${code}/pay/`);
    assert.equal(paid.status, 200);
    assert.equal(paid.json.redirect_url, 'https://checkout.example/cs_test_1');
    assert.equal(await paymentCount(), 0);
  });

  it('records the payment when the tenant returns after paying, exactly once', async () => {
    const code = (await startCheckout()).json.checkout_id;
    await client.post(`/payments/checkout/${code}/pay/`);

    assert.equal((await client.get(`/payments/checkout/${code}/`)).json.checkout.status, 'pending');
    fake.markPaid('cs_test_1', 800000);
    const back = await client.get(`/payments/checkout/${code}/`);
    assert.equal(back.json.checkout.status, 'paid');
    assert.ok(back.json.checkout.payment_id);
    assert.equal((await client.get(`/payments/checkout/${code}/`)).json.checkout.status, 'paid');

    const [payment] = await db.all('SELECT * FROM payments');
    assert.deepEqual([payment.method, payment.amount, payment.status, payment.reference_number],
      ['gcash', 800000, 'confirmed', 'cs_test_1']);
    assert.equal(await balance(), 800000); // 16,000 billed - 8,000 paid
    assert.ok((await db.all('SELECT * FROM notifications WHERE user_id = ?', [owner.id])).some((n) => /paid ₱8,000\.00 online/.test(n.message)));

    assert.equal((await client.post(`/payments/checkout/${code}/pay/`)).status, 400); // already paid
    assert.equal(await paymentCount(), 1);
  });

  it('does not record a payment for a different amount than the checkout', async () => {
    const code = (await startCheckout()).json.checkout_id;
    fake.markPaid('cs_test_1', 100);
    assert.equal((await client.get(`/payments/checkout/${code}/`)).json.checkout.status, 'pending');
    assert.equal(await paymentCount(), 0);
  });

  it('still records money that arrives after the checkout expired or was cancelled', async () => {
    const expired = (await startCheckout()).json.checkout_id;
    await db.run("UPDATE gcash_checkouts SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", [expired]);
    fake.markPaid('cs_test_1', 800000);
    assert.equal((await client.get(`/payments/checkout/${expired}/`)).json.checkout.status, 'paid');

    const cancelled = (await startCheckout()).json.checkout_id;
    await client.post(`/payments/checkout/${cancelled}/cancel/`);
    fake.markPaid('cs_test_2', 800000);
    assert.equal((await client.get(`/payments/checkout/${cancelled}/`)).json.checkout.status, 'paid');
    assert.equal(await paymentCount(), 2);
  });

  it('refuses to pay a checkout that was started with the sandbox', async () => {
    await db.run(
      `INSERT INTO gcash_checkouts (id, tenancy_id, tenant_id, amount, status, created_at, expires_at, provider)
       VALUES ('sandboxcode123456', ?, ?, 800000, 'pending', ?, ?, 'sandbox')`,
      [tenancy.id, tenant.id, nowIso(), new Date(Date.now() + 60_000).toISOString()],
    );
    assert.equal((await client.post('/payments/checkout/sandboxcode123456/pay/')).status, 400);
    assert.equal(await paymentCount(), 0);
  });

  it('shows a clear error and creates nothing when PayMongo is unavailable', async () => {
    fake.failCreate = true;
    const started = await startCheckout();
    assert.equal(started.status, 502);
    assert.match(started.json.message, /not available right now/);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM gcash_checkouts')).n, 0);
  });
});

describe('PayMongo webhook', () => {
  it('records the payment from a signed "paid" event, and ignores repeats', async () => {
    const code = (await startCheckout()).json.checkout_id;
    await client.post(`/payments/checkout/${code}/pay/`);
    const raw = webhookBody('cs_test_1');
    assert.equal((await postWebhook(raw)).status, 200);
    assert.equal(await paymentCount(), 1);
    assert.equal((await postWebhook(raw)).status, 200);
    assert.equal(await paymentCount(), 1);
    assert.equal((await client.get(`/payments/checkout/${code}/`)).json.checkout.status, 'paid');
  });

  it('accepts the live-mode signature too', async () => {
    const code = (await startCheckout()).json.checkout_id;
    const raw = webhookBody('cs_test_1');
    assert.equal((await postWebhook(raw, signature(raw, { field: 'li' }))).status, 200);
    assert.equal((await client.get(`/payments/checkout/${code}/`)).json.checkout.status, 'paid');
  });

  it('refuses unsigned, wrongly signed, altered, and old requests', async () => {
    const code = (await startCheckout()).json.checkout_id;
    const raw = webhookBody('cs_test_1');
    assert.equal((await postWebhook(raw, null)).status, 401); // null: send no signature header at all
    assert.equal((await postWebhook(raw, signature(raw, { secret: 'wrong' }))).status, 401);
    assert.equal((await postWebhook(webhookBody('cs_test_1').replace('cs_test_1', 'cs_test_9'), signature(raw))).status, 401);
    assert.equal((await postWebhook(raw, signature(raw, { t: Math.floor(Date.now() / 1000) - 3600 }))).status, 401);
    assert.equal(await paymentCount(), 0);
    assert.equal((await client.get(`/payments/checkout/${code}/`)).json.checkout.status, 'pending');
  });

  it('ignores other events and unknown checkouts without recording anything', async () => {
    await startCheckout();
    const other = webhookBody('cs_test_1', 'payment.failed');
    assert.equal((await postWebhook(other)).status, 200);
    const unknown = webhookBody('cs_not_ours');
    assert.equal((await postWebhook(unknown)).status, 200);
    assert.equal(await paymentCount(), 0);
  });

  it('is not behind the sign-in or CSRF checks, so PayMongo can call it', async () => {
    client.logout();
    const raw = webhookBody('cs_not_ours');
    const response = await fetch(`${client.base}/api/payments/webhooks/paymongo/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Paymongo-Signature': signature(raw) }, body: raw,
    });
    assert.equal(response.status, 200);
  });
});

describe('PayMongo signature check', () => {
  const offline = async () => { throw new Error('no network in this test'); };
  const gateway = new PayMongoGateway({ secretKey: SECRET_KEY, webhookSecret: WEBHOOK_SECRET, fetchImpl: offline });

  it('accepts only a signature made with the webhook secret over the exact body', () => {
    const raw = webhookBody('cs_x');
    assert.equal(gateway.verifyWebhook(raw, signature(raw)), true);
    assert.equal(gateway.verifyWebhook(`${raw} `, signature(raw)), false);
    assert.equal(gateway.verifyWebhook(raw, undefined), false);
    assert.equal(gateway.verifyWebhook(raw, 'garbage'), false);
  });

  it('refuses everything when no webhook secret is configured', () => {
    const open = new PayMongoGateway({ secretKey: SECRET_KEY, fetchImpl: offline });
    const raw = webhookBody('cs_x');
    assert.equal(open.verifyWebhook(raw, signature(raw)), false);
  });
});