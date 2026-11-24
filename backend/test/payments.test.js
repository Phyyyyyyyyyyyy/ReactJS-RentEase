import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { buildLedger, ledgerFor, monthEnd, monthStart, syncCharges, tenanciesFor } from '../src/billing.js';
import { addDays, nowIso, today } from '../src/lib/format.js';
import { makeApplication, makeProperty, makeUnit, makeUser, reload, setup } from './helpers.js';

const REF = '1234567890123';

let env;
let db;
let client;
let owner;
let otherOwner;
let tenant;
let otherTenant;
let unit;
let tenancyRow;
let day;
let start;

beforeEach(async () => {
  env = await setup();
  ({ db, client } = env);
  owner = await makeUser(db, 'owner', 'owner', { gcash_number: '09171234567', gcash_name: 'Ana Santos' });
  otherOwner = await makeUser(db, 'other_owner', 'owner');
  tenant = await makeUser(db, 'tenant', 'tenant');
  otherTenant = await makeUser(db, 'other_tenant', 'tenant');
  const prop = await makeProperty(db, owner, { name: 'Lahug Apartments', address: 'Salinas Dr' });
  unit = await makeUnit(db, prop, { name: '101', rent: 8000, status: 'occupied' });
  // Approved two months ago (10 AM Manila time), so three monthly bills exist (two past, one current).
  day = today();
  start = monthStart(addDays(monthStart(day), -40));
  tenancyRow = await makeApplication(db, tenant, unit, { status: 'approved', approved_at: `${start}T02:00:00.000Z` });
  await client.login(tenant);
});
afterEach(() => env.close());

const tenancy = async () => (await tenanciesFor(db, { id: tenancyRow.id }))[0];
const ledger = async () => buildLedger(db, await tenancy(), { day });
const count = async (sql, params = []) => (await db.get(sql, params)).n;

/** `amount` in pesos. */
async function pay(amount, { status = 'confirmed', method = 'cash', reference_number = '' } = {}) {
  const id = await db.insert(
    `INSERT INTO payments (tenancy_id, amount, method, reference_number, paid_on, status, recorded_by_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [tenancyRow.id, amount * 100, method, reference_number, day, status, owner.id, nowIso()],
  );
  return db.get('SELECT * FROM payments WHERE id = ?', [id]);
}

describe('billing', () => {
  it('bills one charge per month, due on the last day', async () => {
    const t = await tenancy();
    await syncCharges(db, t, day);
    await syncCharges(db, t, day); // running twice adds nothing
    const charges = await db.all('SELECT * FROM rent_charges ORDER BY period');
    assert.equal(charges.length, 3);
    assert.equal(charges[0].period, start);
    for (const c of charges) {
      assert.equal(c.period.slice(8), '01');
      assert.equal(c.due_date, monthEnd(c.period));
      assert.equal(c.amount, 800000);
    }
  });

  it('handles February and December month ends', () => {
    assert.equal(monthEnd('2028-02-10'), '2028-02-29');
    assert.equal(monthEnd('2027-02-01'), '2027-02-28');
    assert.equal(monthEnd('2026-12-05'), '2026-12-31');
  });

  it('bills nothing before move-in', async () => {
    await db.run('UPDATE applications SET preferred_move_in = ? WHERE id = ?', [addDays(day, 60), tenancyRow.id]);
    await syncCharges(db, await tenancy(), day);
    assert.equal(await count('SELECT COUNT(*) AS n FROM rent_charges'), 0);
  });

  it('marks unpaid past months overdue', async () => {
    const l = await ledger();
    assert.equal(l.balance, 2400000);
    assert.equal(l.overdue, 1600000);
    assert.deepEqual(l.lines.map((x) => x.state), ['overdue', 'overdue', 'due']);
  });

  it('applies a partial payment to the oldest month first', async () => {
    await pay(10000);
    const l = await ledger();
    assert.deepEqual(l.lines.map((x) => [x.state, x.remaining]), [['paid', 0], ['overdue', 600000], ['due', 800000]]);
    assert.equal(l.balance, 1400000);
  });

  it('turns an upfront payment into credit', async () => {
    await pay(40000);
    const l = await ledger();
    assert.equal(l.balance, 0);
    assert.equal(l.credit, 1600000);
    assert.equal(l.months_covered, 2);
    assert.ok(l.lines.every((x) => x.state === 'paid'));
  });

  it('counts only confirmed payments', async () => {
    await pay(8000, { status: 'pending', method: 'gcash', reference_number: REF });
    await pay(8000, { status: 'rejected' });
    const l = await ledger();
    assert.equal(l.balance, 2400000);
    assert.equal(l.pending_total, 800000);
  });

  it('stops billing once the unit is vacated', async () => {
    await db.run("UPDATE units SET status = 'vacant' WHERE id = ?", [unit.id]);
    await client.get('/payments/');
    assert.equal(await count('SELECT COUNT(*) AS n FROM rent_charges'), 0);
  });
});

describe('tenant GCash', () => {
  const url = () => `/payments/${tenancyRow.id}/gcash/`;
  const submit = (overrides = {}) => client.postForm(url(), {
    amount: '8000', reference_number: REF, paid_on: day, note: '', ...overrides,
  });

  it("shows the owner's GCash and the balance", async () => {
    const { json } = await client.get(url());
    assert.deepEqual(json.gcash, { name: 'Ana Santos', number: '09171234567', qr: null });
    assert.equal(json.ledger.balance, '24000.00');
    assert.equal(json.ledger.suggested_amount, '24000.00');
  });

  it('stays pending until the owner confirms', async () => {
    assert.equal((await submit()).status, 201);
    const payment = await db.get('SELECT * FROM payments');
    assert.deepEqual([payment.status, payment.method, payment.recorded_by_id], ['pending', 'gcash', tenant.id]);
    assert.equal((await ledger()).balance, 2400000);
  });

  it('needs an unused 13-digit reference number', async () => {
    assert.ok((await submit({ reference_number: '12345' })).json.errors.reference_number);
    assert.equal(await count('SELECT COUNT(*) AS n FROM payments'), 0);
    await submit();
    assert.match((await submit({ amount: '500' })).json.errors.reference_number[0], /already been submitted/);
    assert.equal(await count('SELECT COUNT(*) AS n FROM payments'), 1);
  });

  it('accepts a rejected reference again', async () => {
    await submit();
    await db.run("UPDATE payments SET status = 'rejected'");
    await submit();
    assert.equal(await count("SELECT COUNT(*) AS n FROM payments WHERE status = 'pending'"), 1);
  });

  it('rejects a future date and a zero amount', async () => {
    const future = await submit({ paid_on: addDays(day, 1) });
    assert.deepEqual(future.json.errors.paid_on, ['The payment date cannot be in the future.']);
    const zero = await submit({ amount: '0', reference_number: '9999999999999' });
    assert.deepEqual(zero.json.errors.amount, ['Ensure this value is greater than or equal to 1.']);
    assert.equal(await count('SELECT COUNT(*) AS n FROM payments'), 0);
  });

  it("can't pay by GCash if the owner hasn't set it up", async () => {
    await db.run("UPDATE users SET gcash_number = '' WHERE id = ?", [owner.id]);
    const response = await submit();
    assert.equal(response.status, 400);
    assert.match(response.json.message, /has not set up GCash/);
    assert.equal(await count('SELECT COUNT(*) AS n FROM payments'), 0);
  });

  it("can't pay into someone else's tenancy", async () => {
    await client.login(otherTenant);
    assert.equal((await submit()).status, 404);
  });

  it('cancels your own pending submission', async () => {
    await submit();
    const payment = await db.get('SELECT * FROM payments');
    assert.equal((await client.get('/payments/')).json.history[0].recorded_by_me, true);
    await client.post(`/payments/submissions/${payment.id}/cancel/`);
    assert.equal(await count('SELECT COUNT(*) AS n FROM payments'), 0);
  });

  it('shows the payments overview, newest month first', async () => {
    const l = (await client.get('/payments/')).json.ledgers[0];
    assert.deepEqual(l.lines.map((x) => x.state), ['due', 'overdue', 'overdue']);
    assert.deepEqual([l.balance, l.overdue], ['24000.00', '16000.00']);
  });

  it('saves a receipt screenshot', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
    assert.equal((await submit({ proof: new File([png], 'receipt.png') })).status, 201);
    const proof = (await client.get('/payments/')).json.history[0].proof;
    assert.match(proof, /^\/media\/payment_proofs\/receipt_[0-9a-f]+\.png$/);
  });
});

describe('owner payments', () => {
  const url = () => `/owner/payments/tenancy/${tenancyRow.id}/`;
  beforeEach(() => client.login(owner));
  const record = (amount, method = 'cash') => client.post(url(), {
    amount, method, paid_on: day, reference_number: '', note: 'Paid in person',
  });

  it('records an in-person payment that counts immediately', async () => {
    const response = await record('8000');
    assert.equal(response.status, 201);
    assert.match(response.json.message, /₱16,000\.00 still owed/);
    const payment = await db.get('SELECT * FROM payments');
    assert.deepEqual([payment.status, payment.recorded_by_id], ['confirmed', owner.id]);
    assert.equal((await ledger()).balance, 1600000);
  });

  it('recording the full balance marks everything paid', async () => {
    await record('24000');
    const l = await ledger();
    assert.deepEqual([l.balance, l.credit], [0, 0]);
  });

  it('suggests the balance, and "Mark paid" totals settle up to each month', async () => {
    const l = (await client.get(url())).json.ledger;
    assert.equal(l.suggested_amount, '24000.00');
    assert.deepEqual(l.lines.map((x) => x.through_total), ['24000.00', '16000.00', '8000.00']);
  });

  it('confirms and rejects GCash payments', async () => {
    const a = await pay(8000, { status: 'pending', method: 'gcash', reference_number: REF });
    const b = await pay(8000, { status: 'pending', method: 'gcash', reference_number: '3210987654321' });
    await client.post(`/owner/payments/${a.id}/confirm/`);
    await client.post(`/owner/payments/${b.id}/reject/`, { reason: 'Not received' });
    const [fa, fb] = [await reload(db, 'payments', a), await reload(db, 'payments', b)];
    assert.deepEqual([fa.status, fb.status, fb.owner_note], ['confirmed', 'rejected', 'Not received']);
    assert.equal((await ledger()).balance, 1600000);
  });

  it('voids a confirmed payment', async () => {
    const p = await pay(8000);
    await client.post(`/owner/payments/${p.id}/void/`);
    assert.equal((await reload(db, 'payments', p)).status, 'rejected');
    assert.equal((await client.get(url())).json.history[0].voided, true);
    assert.equal((await ledger()).balance, 2400000);
  });

  it("can't confirm twice or void a pending payment", async () => {
    const p = await pay(8000, { status: 'pending', method: 'gcash', reference_number: REF });
    assert.equal((await client.post(`/owner/payments/${p.id}/void/`)).status, 400);
    assert.equal((await reload(db, 'payments', p)).status, 'pending');
    await client.post(`/owner/payments/${p.id}/confirm/`);
    assert.equal((await client.post(`/owner/payments/${p.id}/confirm/`)).status, 400);
  });

  it('gives other owners a 404', async () => {
    const p = await pay(8000, { status: 'pending', method: 'gcash', reference_number: REF });
    await client.login(otherOwner);
    assert.equal((await client.get(url())).status, 404);
    assert.equal((await client.post(`/owner/payments/${p.id}/confirm/`)).status, 404);
    assert.equal((await reload(db, 'payments', p)).status, 'pending');
  });

  it('lists tenants and pending payments in the overview', async () => {
    await pay(8000, { status: 'pending', method: 'gcash', reference_number: REF });
    const { json } = await client.get('/owner/payments/');
    assert.deepEqual([json.ledgers.length, json.pending.length], [1, 1]);
    assert.equal(json.outstanding, '24000.00');
    assert.equal(json.gcash_ready, true);
    assert.equal((await client.get('/badges/')).json.pending_payments, 1);
  });
});

describe('access and profile', () => {
  it('keeps the roles apart', async () => {
    assert.equal((await client.get('/owner/payments/')).status, 403);
    await client.login(owner);
    assert.equal((await client.get('/payments/')).status, 403);
  });

  it('approval sets the tenancy start', async () => {
    const unit2 = await makeUnit(db, { id: unit.property_id }, { name: '102', rent: 9000 });
    const app = await makeApplication(db, otherTenant, unit2);
    await client.login(owner);
    await client.post(`/owner/applications/${app.id}/approve/`);
    const fresh = await reload(db, 'applications', app);
    assert.ok(fresh.approved_at);
    const [t] = await tenanciesFor(db, { id: app.id });
    assert.equal(t.start, day);
    assert.equal((await ledgerFor(db, t)).lines.length, 1);
  });

  it('shows GCash fields only to owners', async () => {
    assert.ok(!('gcash_number' in (await client.get('/profile/')).json.user));
    await client.login(owner);
    assert.equal((await client.get('/profile/')).json.user.gcash_number, '09171234567');
  });

  it("validates the owner's GCash number", async () => {
    await client.login(otherOwner);
    const data = { first_name: 'Ben', last_name: 'Cruz', email: 'other_owner@example.com', phone: '',
      gcash_name: 'Ben Cruz', gcash_number: '12345' };
    assert.ok((await client.postForm('/profile/', data)).json.errors.gcash_number);
    assert.equal((await reload(db, 'users', otherOwner)).gcash_number, '');
    await client.postForm('/profile/', { ...data, gcash_number: '0918 765 4321' });
    assert.equal((await reload(db, 'users', otherOwner)).gcash_number, '09187654321');
    const noName = await client.postForm('/profile/', { ...data, gcash_number: '09187654321', gcash_name: '' });
    assert.ok(noName.json.errors.gcash_name);
  });

  it('shows rent due on the tenant dashboard', async () => {
    const { rent } = (await client.get('/dashboard/')).json;
    assert.equal(rent.length, 1);
    assert.deepEqual([rent[0].balance, rent[0].overdue], ['24000.00', '16000.00']);
  });
});
