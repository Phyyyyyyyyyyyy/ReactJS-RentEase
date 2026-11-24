import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { monthStart } from '../src/billing.js';
import { addDays, nowIso, today } from '../src/lib/format.js';
import { notify, remindTenant } from '../src/notifications.js';
import { makeApplication, makeProperty, makeUnit, makeUser, setup } from './helpers.js';

let env;
let db;
let client;
let owner;
let manager;
let tenant;
let prop;
let unit;

beforeEach(async () => {
  env = await setup();
  ({ db, client } = env);
  owner = await makeUser(db, 'owner', 'owner', { gcash_number: '09171234567', gcash_name: 'Ana Santos' });
  manager = await makeUser(db, 'mgr', 'manager');
  tenant = await makeUser(db, 'tenant', 'tenant');
  prop = await makeProperty(db, owner, { name: 'Lahug', address: 'A' });
  await db.run('UPDATE properties SET manager_id = ? WHERE id = ?', [manager.id, prop.id]);
  unit = await makeUnit(db, prop, { name: '101', rent: 8000 });
});
afterEach(() => env.close());

const inbox = async (user) => (await db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id', [user.id]));

describe('notifications', () => {
  it('tells the owner and manager about a new application, and the tenant about the result', async () => {
    await client.login(tenant);
    await client.post(`/browse/${prop.id}/apply/`, { unit: unit.id });
    assert.match((await inbox(owner))[0].message, /Tenant Test applied for 101 at Lahug/);
    assert.equal((await inbox(manager)).length, 1);

    const loser = await makeUser(db, 'loser', 'tenant');
    await makeApplication(db, loser, unit);
    const app = await db.get('SELECT id FROM applications WHERE tenant_id = ?', [tenant.id]);
    await client.login(manager);
    await client.post(`/owner/applications/${app.id}/approve/`);
    assert.match((await inbox(tenant))[0].message, /was approved/);
    assert.match((await inbox(loser))[0].message, /not approved: the unit has been rented/);
  });

  it('tells the owner about GCash payments and the tenant about the decision', async () => {
    const tenancy = await makeApplication(db, tenant, unit, { status: 'approved', approved_at: nowIso() });
    await client.login(tenant);
    await client.postForm(`/payments/${tenancy.id}/gcash/`, { amount: '8000', reference_number: '1234567890123', paid_on: today() });
    assert.match((await inbox(owner))[0].message, /sent a ₱8,000\.00 GCash payment/);
    const payment = await db.get('SELECT id FROM payments');
    await client.login(owner);
    await client.post(`/owner/payments/${payment.id}/reject/`, { reason: 'Not in my GCash history' });
    assert.match((await inbox(tenant)).at(-1).message, /was rejected: Not in my GCash history/);
  });

  it('lists your own notifications, counts unread, and marks them read', async () => {
    await notify(db, tenant.id, 'payment', 'Hello', '/payments');
    await notify(db, owner.id, 'payment', 'Not yours', '/payments');
    await client.login(tenant);
    let { json } = await client.get('/notifications/');
    assert.deepEqual([json.notifications.map((n) => n.message), json.unread], [['Hello'], 1]);
    assert.equal((await client.get('/badges/')).json.unread_notifications, 1);
    const theirs = (await inbox(owner))[0];
    assert.equal((await client.post(`/notifications/${theirs.id}/read/`)).status, 404);
    await client.post(`/notifications/${json.notifications[0].id}/read/`);
    ({ json } = await client.get('/notifications/'));
    assert.equal(json.unread, 0);
    await notify(db, tenant.id, 'lease', 'Two', '');
    await notify(db, tenant.id, 'lease', 'Three', '');
    await client.post('/notifications/read-all/');
    assert.equal((await client.get('/notifications/')).json.unread, 0);
    assert.equal((await inbox(owner))[0].is_read, 0);
  });

  it('reminds a tenant about overdue rent once a month', async () => {
    const twoMonthsAgo = monthStart(addDays(monthStart(today()), -40));
    await makeApplication(db, tenant, unit, { status: 'approved', approved_at: `${twoMonthsAgo}T02:00:00.000Z` });
    await db.run("UPDATE units SET status = 'occupied' WHERE id = ?", [unit.id]);
    await remindTenant(db, tenant.id);
    await remindTenant(db, tenant.id); // no duplicate
    const reminders = (await inbox(tenant)).filter((n) => n.type === 'reminder' && /overdue/.test(n.message));
    assert.equal(reminders.length, 1);
    assert.match(reminders[0].message, /₱16,000\.00 of overdue rent/);
  });

  it('reminds a tenant when rent is due within 5 days', async () => {
    await makeApplication(db, tenant, unit, { status: 'approved', approved_at: nowIso() });
    await db.run("UPDATE units SET status = 'occupied' WHERE id = ?", [unit.id]);
    const dueSoon = addDays(monthStart(addDays(monthStart(today()), 40)), -3); // 3 days before this month ends
    await remindTenant(db, tenant.id, dueSoon);
    assert.ok((await inbox(tenant)).some((n) => /is due on/.test(n.message)));
  });
});
