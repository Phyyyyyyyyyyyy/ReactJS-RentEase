import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { buildLedger, monthStart, tenanciesFor } from '../src/billing.js';
import { addDays, addMonths, today } from '../src/lib/format.js';
import { makeApplication, makeProperty, makeUser, setup } from './helpers.js';

let env;
let db;
let client;
let owner;
let tenant;
let prop;

beforeEach(async () => {
  env = await setup();
  ({ db, client } = env);
  owner = await makeUser(db, 'owner', 'owner');
  tenant = await makeUser(db, 'tenant', 'tenant');
  prop = await makeProperty(db, owner, { name: 'Lessandra Roma', address: 'Block 2 Lot 42, Lawaan', city: 'Talisay' });
  await client.login(owner);
});
afterEach(() => env.close());

const RTO = {
  name: 'Block 2 Lot 42', bedrooms: 3, bathrooms: 2, floor_area: 80, status: 'vacant', listing_type: 'rent_to_own',
  monthly_rent: '20000', contract_price: '3000000', term_years: 12, interest_rate: '5', reservation_fee: '60000',
};
const addUnit = (body) => client.post(`/owner/properties/${prop.id}/units/`, body);

/** Create a unit through the API, have the tenant apply, and approve it. Returns the tenancy. */
async function approved(body) {
  const unit = (await addUnit(body)).json.unit;
  const app = await makeApplication(db, tenant, { id: unit.id });
  await client.post(`/owner/applications/${app.id}/approve/`);
  return (await tenanciesFor(db, { id: app.id }))[0];
}

const record = (tenancyId, body) => client.post(`/owner/payments/tenancy/${tenancyId}/`,
  { method: 'check', paid_on: today(), ...body });

describe('rent-to-own units', () => {
  it('saves the contract terms', async () => {
    const response = await addUnit(RTO);
    assert.equal(response.status, 201);
    const u = response.json.unit;
    assert.deepEqual(
      [u.listing_type, u.listing_display, u.contract_price, u.term_years, u.interest_rate, u.reservation_fee, u.monthly_rent],
      ['rent_to_own', 'Rent-to-own', '3000000.00', 12, '5.00', '60000.00', '20000.00'],
    );
    const rent = (await addUnit({ name: 'Studio', bedrooms: 0, bathrooms: 1, floor_area: 20, monthly_rent: '8000', status: 'vacant' })).json.unit;
    assert.equal(rent.listing_type, 'rent');
    assert.ok(!('contract_price' in rent));
  });

  it('checks the contract terms', async () => {
    const { json } = await addUnit({ ...RTO, contract_price: '', term_years: 0, interest_rate: '120' });
    assert.deepEqual(Object.keys(json.errors).sort(), ['contract_price', 'interest_rate', 'term_years']);
    const tooBig = await addUnit({ ...RTO, monthly_rent: '4000000' });
    assert.match(tooBig.json.errors.monthly_rent[0], /can’t be more than the contract price/);
  });

  it('editing without the type keeps it rent-to-own', async () => {
    const unit = (await addUnit(RTO)).json.unit;
    const { listing_type, ...withoutType } = RTO;
    const response = await client.put(`/owner/units/${unit.id}/`, { ...withoutType, monthly_rent: '21000' });
    assert.equal(response.json.unit.listing_type, 'rent_to_own');
  });

  it('the lease runs for the whole term and keeps the contract', async () => {
    const t = await approved(RTO);
    assert.equal(t.lease.end_date, addDays(addMonths(t.lease.start_date, 144), -1));
    await client.login(tenant);
    const lease = (await client.get('/payments/')).json.ledgers[0].tenancy.lease;
    assert.deepEqual([lease.type, lease.contract_price, lease.term_years, lease.reservation_fee], ['rent_to_own', '3000000.00', 12, '60000.00']);
  });

  it('a reservation payment counts toward the contract, not the monthly bills', async () => {
    const t = await approved(RTO);
    await record(t.id, { amount: '60000', kind: 'reservation', method: 'cash' });
    await record(t.id, { amount: '20000', kind: 'monthly', reference_number: 'CHK-001' });
    const ledger = await buildLedger(db, (await tenanciesFor(db, { id: t.id }))[0]);
    assert.equal(ledger.balance, 0); // this month's ₱20,000 is paid; the reservation didn't overpay it
    assert.equal(ledger.credit, 0);
    const { statement } = (await client.get(`/payments/${t.id}/statement/`)).json;
    assert.deepEqual(statement.payments.map((p) => [p.description, p.amount, p.mode]),
      [['Reservation payment', '60000.00', 'Cash (in person)'], ['Rent payment', '20000.00', 'Check deposit']]);
    assert.deepEqual([statement.totals.total_paid, statement.totals.remaining_balance, statement.totals.percent_paid],
      ['80000.00', '2920000.00', 2.7]);
  });
});

describe('payment terms (every N months)', () => {
  const RENT = { name: '201', bedrooms: 1, bathrooms: 1, floor_area: 30, monthly_rent: '10000', status: 'vacant' };

  it('bills every 2 months, each bill covering 2 months', async () => {
    const unit = (await addUnit({ ...RENT, payment_interval_months: 2 })).json.unit;
    assert.deepEqual([unit.payment_interval_months, unit.payment_terms], [2, 'Every 2 months']);
    const t = await approved({ ...RENT, name: '202', payment_interval_months: 2 });
    assert.equal(t.lease.payment_interval_months, 2);
    const fiveMonthsOn = addMonths(monthStart(today()), 4);
    const ledger = await buildLedger(db, t, { day: fiveMonthsOn });
    assert.deepEqual(ledger.lines.map((l) => [l.charge.period, l.charge.amount, l.charge.months]), [
      [monthStart(today()), 2000000, 2],
      [addMonths(monthStart(today()), 2), 2000000, 2],
      [addMonths(monthStart(today()), 4), 2000000, 2],
    ]);
    assert.equal(ledger.current.charge.period, fiveMonthsOn); // the bill covering this month
    const lease = (await client.get(`/owner/payments/tenancy/${t.id}/`)).json.ledger.tenancy.lease;
    assert.deepEqual([lease.payment_terms, lease.amount_per_payment], ['Every 2 months', '20000.00']);
  });

  it('the last bill only covers the months left in the lease', async () => {
    const t = await approved({ ...RENT, payment_interval_months: 5 }); // 12-month lease: 5 + 5 + 2
    const ledger = await buildLedger(db, t, { day: addMonths(today(), 13) });
    assert.deepEqual(ledger.lines.map((l) => l.charge.months), [5, 5, 2]);
    assert.equal(ledger.lines.at(-1).charge.amount, 2000000);
  });

  it('a 12-month lease starting mid-month gets 12 bills, not 13', async () => {
    const t = await approved(RENT);
    await db.run("UPDATE leases SET start_date = '2025-01-15', end_date = '2026-01-14' WHERE id = ?", [t.lease.id]);
    const fresh = (await tenanciesFor(db, { id: t.id }))[0];
    const ledger = await buildLedger(db, fresh, { day: '2026-06-01' });
    assert.equal(ledger.lines.length, 12);
    assert.deepEqual([ledger.lines[0].charge.period, ledger.lines.at(-1).charge.period], ['2025-01-01', '2025-12-01']);
  });

  it('only allows 1 to 12 months', async () => {
    assert.ok((await addUnit({ ...RENT, payment_interval_months: 0 })).json.errors.payment_interval_months);
    assert.ok((await addUnit({ ...RENT, payment_interval_months: 13 })).json.errors.payment_interval_months);
  });
});

describe('payment log and statement of account', () => {
  it('records the mode of payment, including checks and online bank deposits', async () => {
    const t = await approved({ name: '1', bedrooms: 1, bathrooms: 1, floor_area: 1, monthly_rent: '5000', status: 'vacant' });
    for (const method of ['check', 'online_bank']) assert.equal((await record(t.id, { amount: '100', method })).status, 201);
    assert.ok((await record(t.id, { amount: '100', kind: 'bribe' })).json.errors.kind);
    const history = (await client.get(`/owner/payments/tenancy/${t.id}/`)).json.history;
    assert.deepEqual(history.map((p) => p.method_display).sort(), ['Check deposit', 'Online bank deposit']);
  });

  it('is visible only to the tenant, the owner, and the manager', async () => {
    const t = await approved(RTO);
    const manager = await makeUser(db, 'mgr', 'manager');
    await db.run('UPDATE properties SET manager_id = ? WHERE id = ?', [manager.id, prop.id]);
    for (const user of [owner, tenant, manager]) {
      await client.login(user);
      assert.equal((await client.get(`/payments/${t.id}/statement/`)).status, 200, user.username);
    }
    for (const role of ['tenant', 'owner']) {
      await client.login(await makeUser(db, `other_${role}`, role));
      assert.equal((await client.get(`/payments/${t.id}/statement/`)).status, 404, role);
      assert.equal((await client.get(`/payments/${t.id}/statement/export/`)).status, 404, role);
    }
  });

  it('exports CSV like the spreadsheet', async () => {
    const t = await approved(RTO);
    await record(t.id, { amount: '60000', kind: 'reservation', method: 'cash', note: '=cmd()' });
    const response = await fetch(`${client.base}/api/payments/${t.id}/statement/export/`,
      { headers: { Cookie: `sessionid=${client.cookies.sessionid}` } });
    assert.match(response.headers.get('content-disposition'), /attachment; filename="statement-/);
    const csv = await response.text();
    for (const expected of ['Statement of Account', 'Term,12 yrs / Rent to Own', 'Contract price (PHP),3000000.00',
      'Interest rate,5.00% per annum', '1,Reservation payment', '60000.00,Cash (in person)', 'Remaining balance (PHP),2940000.00']) {
      assert.ok(csv.includes(expected), expected);
    }
    assert.ok(csv.includes("'=cmd()"), 'formula text is made harmless');
  });
});
