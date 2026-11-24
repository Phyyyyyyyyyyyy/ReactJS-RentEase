import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { addDays, nowIso, today } from '../src/lib/format.js';
import { makeApplication, makeProperty, makeUnit, makeUser, setup } from './helpers.js';

let env;
let db;
let client;
let owner;
let apt;
let studio;
let tenancy;

beforeEach(async () => {
  env = await setup();
  ({ db, client } = env);
  owner = await makeUser(db, 'owner', 'owner');
  const tenant = await makeUser(db, 'tenant', 'tenant');
  apt = await makeProperty(db, owner, { name: 'Apartments', address: 'A' });
  studio = await makeProperty(db, owner, { name: 'Studios', address: 'B' });
  const unit = await makeUnit(db, apt, { name: '101', rent: 8000, status: 'occupied' });
  tenancy = await makeApplication(db, tenant, unit, { status: 'approved', approved_at: nowIso() });
  await client.login(owner);
});
afterEach(() => env.close());

/** amount in pesos */
const payment = (amount, status, paidOn = today()) => db.insert(
  `INSERT INTO payments (tenancy_id, amount, method, paid_on, status, created_at) VALUES (?, ?, 'cash', ?, ?, ?)`,
  [tenancy.id, amount * 100, paidOn, status, nowIso()]);
const addExpense = (overrides = {}) => client.post('/owner/expenses/', {
  property: apt.id, category: 'repairs', amount: '1500', spent_on: today(), note: 'Fixed the sink', ...overrides,
});

describe('expenses', () => {
  it('records, lists, and deletes expenses', async () => {
    assert.equal((await addExpense()).status, 201);
    await addExpense({ property: studio.id, category: 'utilities', amount: '500.50' });
    let { json } = await client.get('/owner/expenses/');
    assert.equal(json.expenses.length, 2);
    assert.equal(json.total, '2000.50');
    ({ json } = await client.get('/owner/expenses/', { property: studio.id }));
    assert.deepEqual(json.expenses.map((e) => e.category_display), ['Utilities']);
    assert.equal((await client.delete(`/owner/expenses/${json.expenses[0].id}/`)).status, 200);
    assert.equal((await client.get('/owner/expenses/')).json.expenses.length, 1);
  });

  it('checks the amount, date, category, and property', async () => {
    const bad = await client.post('/owner/expenses/', { property: '', category: 'bribes', amount: '-5', spent_on: addDays(today(), 1) });
    assert.deepEqual(Object.keys(bad.json.errors).sort(), ['amount', 'category', 'property', 'spent_on']);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM expenses')).n, 0);
  });

  it("can't touch another owner's properties or expenses", async () => {
    await addExpense();
    const id = (await db.get('SELECT id FROM expenses')).id;
    await client.login(await makeUser(db, 'owner2', 'owner'));
    assert.equal((await addExpense()).status, 400); // apt isn't theirs
    assert.deepEqual((await client.get('/owner/expenses/')).json.expenses, []);
    assert.equal((await client.delete(`/owner/expenses/${id}/`)).status, 404);
    await client.login(await makeUser(db, 'mgr', 'manager'));
    assert.equal((await client.get('/owner/reports/')).status, 403);
  });
});

describe('financial report', () => {
  it('adds up rent received and expenses per property for the period', async () => {
    await payment(8000, 'confirmed');
    await payment(8000, 'pending'); // not received yet
    await payment(5000, 'rejected');
    await payment(3000, 'confirmed', addDays(today(), -400)); // outside the period
    await addExpense();
    await addExpense({ property: studio.id, category: 'taxes', amount: '2500' });
    const start = addDays(today(), -30);
    const { json } = await client.get('/owner/reports/', { start, end: today() });
    assert.deepEqual([json.total_income, json.total_expenses, json.net], ['8000.00', '4000.00', '4000.00']);
    const rows = Object.fromEntries(json.properties.map((p) => [p.name, p]));
    assert.deepEqual([rows.Apartments.income, rows.Apartments.expenses, rows.Apartments.net], ['8000.00', '1500.00', '6500.00']);
    assert.deepEqual([rows.Studios.net], ['-2500.00']);
    assert.deepEqual(json.categories.map((c) => [c.label, c.total]), [['Repairs', '1500.00'], ['Taxes & fees', '2500.00']]);
  });

  it('refuses an end date before the start date', async () => {
    const response = await client.get('/owner/reports/', { start: today(), end: addDays(today(), -1) });
    assert.equal(response.status, 400);
  });

  it('exports CSV, with formula-looking text made harmless', async () => {
    await payment(8000, 'confirmed');
    await addExpense({ note: '=HYPERLINK("http://evil.example","click")' });
    const response = await fetch(`${client.base}/api/owner/reports/export/?start=${addDays(today(), -30)}&end=${today()}`,
      { headers: { Cookie: `sessionid=${client.cookies.sessionid}` } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/csv/);
    assert.match(response.headers.get('content-disposition'), /attachment; filename="rentease-report-/);
    const csv = await response.text();
    assert.match(csv, /Apartments,8000\.00,1,1500\.00,6500\.00/);
    assert.match(csv, /"'=HYPERLINK\(""http/);
  });
});
