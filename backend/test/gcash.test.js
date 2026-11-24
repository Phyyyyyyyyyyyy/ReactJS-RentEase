import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { buildLedger, monthStart, tenanciesFor } from '../src/billing.js';
import { SandboxGCashGateway } from '../src/gcash.js';
import { addDays, nowIso, today } from '../src/lib/format.js';
import { makeApplication, makeProperty, makeUnit, makeUser, setup } from './helpers.js';

let env;
let db;
let client;
let owner;
let tenant;
let tenancy;

beforeEach(async () => {
  env = await setup();
  ({ db, client } = env);
  owner = await makeUser(db, 'owner', 'owner');
  tenant = await makeUser(db, 'tenant', 'tenant');
  const prop = await makeProperty(db, owner, { name: 'Lahug', address: 'A' });
  const unit = await makeUnit(db, prop, { name: '101', rent: 8000, status: 'occupied' });
  const start = monthStart(addDays(monthStart(today()), -1)); // last month: two bills
  tenancy = await makeApplication(db, tenant, unit, { status: 'approved', approved_at: `${start}T02:00:00.000Z` });
  await client.login(tenant);
});
afterEach(() => env.close());

const startCheckout = (amount = '8000') => client.post(`/payments/${tenancy.id}/checkout/`, { amount });
const balance = async () => (await buildLedger(db, (await tenanciesFor(db, { id: tenancy.id }))[0])).balance;

describe('GCash online checkout (sandbox)', () => {
  it('pays through the checkout, confirming the payment right away', async () => {
    const started = await startCheckout();
    assert.equal(started.status, 201);
    assert.equal(started.json.sandbox, true);
    const code = started.json.checkout_id;
    const page = await client.get(`/payments/checkout/${code}/`);
    assert.deepEqual([page.json.checkout.amount, page.json.checkout.status, page.json.pay_to.unit], ['8000.00', 'pending', '101']);

    const paid = await client.post(`/payments/checkout/${code}/pay/`);
    assert.equal(paid.status, 200);
    const payment = await db.get('SELECT * FROM payments WHERE id = ?', [paid.json.payment_id]);
    assert.deepEqual([payment.status, payment.method, payment.amount], ['confirmed', 'gcash', 800000]);
    assert.match(payment.reference_number, /^\d{13}$/);
    assert.equal(await balance(), 800000); // 16,000 billed - 8,000 paid
    assert.ok((await db.all('SELECT * FROM notifications WHERE user_id = ?', [owner.id])).some((n) => /paid ₱8,000\.00 online/.test(n.message)));
  });

  it('each checkout can be paid only once, even if the button is pressed twice at once', async () => {
    const code = (await startCheckout()).json.checkout_id;
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => client.post(`/payments/checkout/${code}/pay/`)));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM payments')).n, 1);
  });

  it('expired and cancelled checkouts charge nothing', async () => {
    const expired = (await startCheckout()).json.checkout_id;
    await db.run("UPDATE gcash_checkouts SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", [expired]);
    assert.equal((await client.get(`/payments/checkout/${expired}/`)).json.checkout.status, 'expired');
    assert.equal((await client.post(`/payments/checkout/${expired}/pay/`)).status, 400);
    const cancelled = (await startCheckout()).json.checkout_id;
    await client.post(`/payments/checkout/${cancelled}/cancel/`);
    assert.equal((await client.post(`/payments/checkout/${cancelled}/pay/`)).status, 400);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM payments')).n, 0);
  });

  it('checks the amount, and only works for your own tenancy and checkout', async () => {
    assert.ok((await startCheckout('0')).json.errors.amount);
    assert.ok((await startCheckout('-500')).json.errors.amount);
    const code = (await startCheckout()).json.checkout_id;
    await client.login(await makeUser(db, 'other', 'tenant'));
    assert.equal((await client.post(`/payments/${tenancy.id}/checkout/`, { amount: '1' })).status, 404);
    assert.equal((await client.get(`/payments/checkout/${code}/`)).status, 404);
    assert.equal((await client.post(`/payments/checkout/${code}/pay/`)).status, 404);
    await client.login(owner);
    assert.equal((await client.post(`/payments/checkout/${code}/pay/`)).status, 403);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM payments')).n, 0);
  });

  it('makes 13-digit reference numbers', () => {
    const gateway = new SandboxGCashGateway();
    for (let i = 0; i < 50; i += 1) assert.match(gateway.verifyPayment().reference, /^[1-9]\d{12}$/);
  });
});

describe('receipts', () => {
  it('shows a receipt for a confirmed payment to the tenant and the owner only', async () => {
    const code = (await startCheckout()).json.checkout_id;
    const { payment_id: id } = (await client.post(`/payments/checkout/${code}/pay/`)).json;
    const { json } = await client.get(`/payments/${id}/receipt/`);
    assert.equal(json.receipt.number, `RE-${String(id).padStart(6, '0')}`);
    assert.deepEqual([json.receipt.amount, json.receipt.method_display, json.receipt.unit, json.receipt.balance_now],
      ['8000.00', 'GCash', '101', '8000.00']);
    await client.login(owner);
    assert.equal((await client.get(`/payments/${id}/receipt/`)).status, 200);
    await client.login(await makeUser(db, 'snoop', 'tenant'));
    assert.equal((await client.get(`/payments/${id}/receipt/`)).status, 404);
    await client.login(await makeUser(db, 'owner2', 'owner'));
    assert.equal((await client.get(`/payments/${id}/receipt/`)).status, 404);
  });

  it('has no receipt until a payment is confirmed', async () => {
    const id = await db.insert(
      `INSERT INTO payments (tenancy_id, amount, method, reference_number, paid_on, status, recorded_by_id, created_at)
       VALUES (?, 800000, 'gcash', '1234567890123', ?, 'pending', ?, ?)`, [tenancy.id, today(), tenant.id, nowIso()]);
    assert.equal((await client.get(`/payments/${id}/receipt/`)).status, 404);
  });
});
