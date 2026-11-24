import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { buildLedger, monthEnd, monthStart, tenanciesFor } from '../src/billing.js';
import { addDays, addMonths, today } from '../src/lib/format.js';
import { backfillLeases } from '../src/leases.js';
import { makeApplication, makeProperty, makeUnit, makeUser, reload, setup } from './helpers.js';

let env;
let db;
let client;
let owner;
let manager;
let tenant;
let prop;
let unit;
let application;

beforeEach(async () => {
  env = await setup();
  ({ db, client } = env);
  owner = await makeUser(db, 'owner', 'owner');
  manager = await makeUser(db, 'mgr', 'manager');
  tenant = await makeUser(db, 'tenant', 'tenant');
  prop = await makeProperty(db, owner, { name: 'Lahug Apartments', address: 'Salinas Dr' });
  unit = await makeUnit(db, prop, { name: '101', rent: 8000 });
  application = await makeApplication(db, tenant, unit);
  await client.login(owner);
});
afterEach(() => env.close());

const approve = () => client.post(`/owner/applications/${application.id}/approve/`);
const lease = () => db.get('SELECT * FROM leases WHERE application_id = ?', [application.id]);
const tenancy = async () => (await tenanciesFor(db, { id: application.id }))[0];

describe('leases', () => {
  it('approving an application creates a 12-month lease at the unit rent', async () => {
    await approve();
    const l = await lease();
    assert.deepEqual([l.start_date, l.end_date, l.monthly_rent, l.status],
      [today(), addDays(addMonths(today(), 12), -1), 800000, 'active']);
    await client.login(tenant);
    const { json } = await client.get('/leases/');
    assert.equal(json.leases.length, 1);
    assert.deepEqual([json.leases[0].status, json.leases[0].monthly_rent, json.leases[0].property.name],
      ['active', '8000.00', 'Lahug Apartments']);
    assert.equal((await client.get('/payments/')).json.ledgers[0].tenancy.lease.end_date, l.end_date);
  });

  it('starts on the preferred move-in date when that is later', async () => {
    const moveIn = addDays(today(), 20);
    await db.run('UPDATE applications SET preferred_move_in = ? WHERE id = ?', [moveIn, application.id]);
    await approve();
    assert.equal((await lease()).start_date, moveIn);
  });

  it('bills the lease rent, not later changes to the unit rent', async () => {
    await approve();
    await db.run('UPDATE units SET monthly_rent = 999900 WHERE id = ?', [unit.id]);
    const ledger = await buildLedger(db, await tenancy());
    assert.equal(ledger.lines[0].charge.amount, 800000);
  });

  it('renews: a later end date, and a new rent for months not billed yet', async () => {
    await approve();
    const old = await lease();
    const tooEarly = await client.post(`/owner/leases/${old.id}/renew/`, { end_date: old.end_date });
    assert.match(tooEarly.json.errors.end_date[0], /must be after/);
    const newEnd = addMonths(old.end_date, 12);
    const response = await client.post(`/owner/leases/${old.id}/renew/`, { end_date: newEnd, monthly_rent: '8500' });
    assert.match(response.json.message, /renewed until/);
    const renewed = await lease();
    assert.deepEqual([renewed.end_date, renewed.monthly_rent], [newEnd, 850000]);
  });

  it('terminates: billing stops, the unit is vacant again, and it can’t be renewed', async () => {
    await approve();
    const l = await lease();
    const response = await client.post(`/owner/leases/${l.id}/terminate/`);
    assert.equal(response.status, 200);
    const ended = await lease();
    assert.deepEqual([ended.status, ended.end_date], ['terminated', today()]);
    assert.equal((await reload(db, 'units', unit)).status, 'vacant');
    // Months after termination are never billed.
    const later = await buildLedger(db, await tenancy(), { day: addMonths(today(), 3) });
    assert.equal(later.lines.length, 1);
    assert.equal((await client.post(`/owner/leases/${l.id}/terminate/`)).status, 400);
    assert.equal((await client.post(`/owner/leases/${l.id}/renew/`, { end_date: addMonths(today(), 24) })).status, 400);
  });

  it('a lease terminated before it starts bills nothing', async () => {
    await db.run('UPDATE applications SET preferred_move_in = ? WHERE id = ?', [addDays(today(), 40), application.id]);
    await approve();
    await client.post(`/owner/leases/${(await lease()).id}/terminate/`);
    const ledger = await buildLedger(db, await tenancy(), { day: addMonths(today(), 3) });
    assert.equal(ledger.lines.length, 0);
  });

  it('an expired lease stops billing at its end date until renewed', async () => {
    await approve();
    const start = monthStart(addMonths(today(), -3));
    const end = monthEnd(addMonths(today(), -2)); // ended last month or the month before
    await db.run('UPDATE leases SET start_date = ?, end_date = ?', [start, end]);
    const t = await tenancy();
    const ledger = await buildLedger(db, t, { active: false });
    assert.equal(ledger.lines.at(-1).charge.period, monthStart(end));
    await client.login(tenant);
    assert.equal((await client.get('/leases/')).json.leases[0].status, 'expired');
    await client.login(owner);
    await client.post(`/owner/leases/${t.lease.id}/renew/`, { end_date: addMonths(today(), 6) });
    assert.equal((await client.get(`/owner/payments/tenancy/${application.id}/`)).json.ledger.tenancy.lease.status, 'active');
  });

  it('sets the deposit, which must not be negative', async () => {
    await approve();
    const l = await lease();
    assert.equal((await client.put(`/owner/leases/${l.id}/`, { deposit: '-1' })).status, 400);
    await client.put(`/owner/leases/${l.id}/`, { deposit: '16000' });
    assert.equal((await lease()).deposit, 1600000);
  });

  it("only the property's owner or manager can change a lease", async () => {
    await approve();
    const l = await lease();
    await client.login(manager);
    assert.equal((await client.put(`/owner/leases/${l.id}/`, { deposit: '1' })).status, 404); // not their property yet
    await db.run('UPDATE properties SET manager_id = ? WHERE id = ?', [manager.id, prop.id]);
    assert.equal((await client.put(`/owner/leases/${l.id}/`, { deposit: '1' })).status, 200);
    await client.login(await makeUser(db, 'owner2', 'owner'));
    assert.equal((await client.post(`/owner/leases/${l.id}/terminate/`)).status, 404);
    await client.login(tenant);
    assert.equal((await client.post(`/owner/leases/${l.id}/terminate/`)).status, 403);
    assert.equal((await lease()).status, 'active');
  });

  it('gives tenancies from before leases existed a lease', async () => {
    const legacy = await makeApplication(db, await makeUser(db, 't2', 'tenant'), await makeUnit(db, prop, { name: '102', rent: 9000 }),
      { status: 'approved', approved_at: new Date().toISOString() });
    assert.equal(await backfillLeases(db), 1);
    assert.equal(await backfillLeases(db), 0);
    const l = await db.get('SELECT * FROM leases WHERE application_id = ?', [legacy.id]);
    assert.deepEqual([l.start_date, l.monthly_rent], [today(), 900000]);
  });

  it('adds months like a calendar (Jan 31 + 1 month = end of February)', () => {
    assert.equal(addMonths('2027-01-31', 1), '2027-02-28');
    assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
    assert.equal(addMonths('2026-11-24', 12), '2027-11-24');
    assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
  });
});
