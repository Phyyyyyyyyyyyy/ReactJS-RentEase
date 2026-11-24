import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../src/db.js';
import { today } from '../src/lib/format.js';
import { makeApplication, makeProperty, makeUnit, makeUser, reload, setup } from './helpers.js';

let env;
let db;
let client;
let owner;
let manager;
let otherManager;
let tenant;
let managed;
let unmanaged;
let managedUnit;
let unmanagedUnit;

beforeEach(async () => {
  env = await setup();
  ({ db, client } = env);
  owner = await makeUser(db, 'owner', 'owner', { gcash_number: '09171234567', gcash_name: 'Ana Santos' });
  manager = await makeUser(db, 'mgr', 'manager');
  otherManager = await makeUser(db, 'mgr2', 'manager');
  tenant = await makeUser(db, 'tenant', 'tenant');
  managed = await makeProperty(db, owner, { name: 'Managed Place', address: 'A St' });
  unmanaged = await makeProperty(db, owner, { name: 'Owner Only', address: 'B St' });
  await db.run('UPDATE properties SET manager_id = ? WHERE id = ?', [manager.id, managed.id]);
  managedUnit = await makeUnit(db, managed, { name: '1A', rent: 8000 });
  unmanagedUnit = await makeUnit(db, unmanaged, { name: '2A', rent: 9000 });
  await client.login(manager);
});
afterEach(() => env.close());

describe('Property Manager', () => {
  it('sees only the properties assigned to them', async () => {
    const { json } = await client.get('/owner/properties/');
    assert.deepEqual(json.properties.map((p) => p.name), ['Managed Place']);
    assert.equal(json.properties[0].manager.username, 'mgr');
    const detail = await client.get(`/owner/properties/${managed.id}/`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.can_edit, false);
    assert.equal((await client.get(`/owner/properties/${unmanaged.id}/`)).status, 404);
  });

  it("can't change properties, units, or managers", async () => {
    const property = { name: 'X', property_type: 'house', address: 'Y', city: 'Z' };
    assert.equal((await client.post('/owner/properties/', property)).status, 403);
    assert.equal((await client.put(`/owner/properties/${managed.id}/`, property)).status, 403);
    assert.equal((await client.delete(`/owner/properties/${managed.id}/`)).status, 403);
    assert.equal((await client.post(`/owner/properties/${managed.id}/units/`, {})).status, 403);
    assert.equal((await client.put(`/owner/units/${managedUnit.id}/`, {})).status, 403);
    assert.equal((await client.put(`/owner/properties/${managed.id}/manager/`, { manager: otherManager.id })).status, 403);
    assert.ok(await reload(db, 'properties', managed));
  });

  it('reviews applications for managed properties only', async () => {
    const mine = await makeApplication(db, tenant, managedUnit);
    const notMine = await makeApplication(db, tenant, unmanagedUnit);
    const { json } = await client.get('/owner/applications/');
    assert.deepEqual(json.applications.map((a) => a.id), [mine.id]);
    assert.equal((await client.get('/badges/')).json.pending_applications, 1);
    assert.equal((await client.post(`/owner/applications/${notMine.id}/approve/`)).status, 404);
    assert.equal((await client.post(`/owner/applications/${mine.id}/approve/`)).status, 200);
    assert.equal((await reload(db, 'applications', mine)).status, 'approved');
  });

  it('confirms payments for managed properties only', async () => {
    const approvedAt = new Date().toISOString();
    const tenancy = await makeApplication(db, tenant, managedUnit, { status: 'approved', approved_at: approvedAt });
    const other = await makeApplication(db, tenant, unmanagedUnit, { status: 'approved', approved_at: approvedAt });
    const pay = (t, ref) => db.insert(
      `INSERT INTO payments (tenancy_id, amount, method, reference_number, paid_on, status, recorded_by_id, created_at)
       VALUES (?, 800000, 'gcash', ?, ?, 'pending', ?, ?)`, [t.id, ref, today(), tenant.id, approvedAt]);
    const mine = await pay(tenancy, '1111111111111');
    const notMine = await pay(other, '2222222222222');
    const overview = (await client.get('/owner/payments/')).json;
    assert.deepEqual(overview.pending.map((p) => p.id), [mine]);
    assert.equal(overview.gcash_ready, true);
    assert.equal((await client.post(`/owner/payments/${notMine}/confirm/`)).status, 404);
    assert.equal((await client.post(`/owner/payments/${mine}/confirm/`)).status, 200);
    assert.equal((await client.get(`/owner/payments/tenancy/${other.id}/`)).status, 404);
  });

  it('gets a dashboard for the managed properties', async () => {
    const { json } = await client.get('/dashboard/');
    assert.equal(json.role, 'manager');
    assert.deepEqual([json.property_count, json.unit_count], [1, 1]);
  });
});

describe('owners assigning managers', () => {
  beforeEach(() => client.login(owner));

  it('lists active managers and assigns or removes one', async () => {
    const { json } = await client.get('/owner/managers/');
    assert.deepEqual(json.managers.map((m) => m.username).sort(), ['mgr', 'mgr2']);
    let response = await client.put(`/owner/properties/${unmanaged.id}/manager/`, { manager: otherManager.id });
    assert.match(response.json.message, /now manages Owner Only/);
    assert.equal((await reload(db, 'properties', unmanaged)).manager_id, otherManager.id);
    response = await client.put(`/owner/properties/${unmanaged.id}/manager/`, { manager: '' });
    assert.equal((await reload(db, 'properties', unmanaged)).manager_id, null);
  });

  it('only accepts active Property Manager accounts', async () => {
    for (const bad of [tenant.id, owner.id, 99999, 'abc']) {
      const response = await client.put(`/owner/properties/${managed.id}/manager/`, { manager: bad });
      assert.equal(response.status, 400, String(bad));
    }
    await db.run('UPDATE users SET is_active = 0 WHERE id = ?', [otherManager.id]);
    assert.equal((await client.put(`/owner/properties/${managed.id}/manager/`, { manager: otherManager.id })).status, 400);
    assert.equal((await reload(db, 'properties', managed)).manager_id, manager.id);
  });

  it("can't assign a manager to another owner's property", async () => {
    await client.login(await makeUser(db, 'owner2', 'owner'));
    assert.equal((await client.put(`/owner/properties/${managed.id}/manager/`, { manager: otherManager.id })).status, 404);
  });

  it("other users can't list managers", async () => {
    await client.login(tenant);
    assert.equal((await client.get('/owner/managers/')).status, 403);
  });
});

describe('upgrading an existing database', () => {
  it('turns Staff accounts into Property Managers', async () => {
    const old = await openDatabase({ url: '', sqlitePath: ':memory:' });
    await old.run(`INSERT INTO users (username, email, password, role, date_joined)
      VALUES ('ana', 'ana@example.com', 'x', 'staff', '2026-01-01T00:00:00.000Z')`);
    await old.migrate();
    assert.equal((await old.get("SELECT role FROM users WHERE username = 'ana'")).role, 'manager');
    await old.close();
  });
});
