/**
 * PD3 checklist tests: validation, access control, data integrity, and error
 * handling for the core feature (properties, units, applications, payments).
 * Run with `npm test` in backend/ (the Node.js equivalent of `python manage.py test`).
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { config } from '../src/config.js';
import { addDays } from '../src/lib/format.js';
import { apiErrorHandler } from '../src/lib/http.js';
import { today } from '../src/lib/format.js';
import { makeApplication, makeProperty, makeUnit, makeUser, reload, setup } from './helpers.js';

let env;
let db;
let client;
let owner;
let otherOwner;
let tenant;
let otherTenant;
let property;
let unit;
beforeEach(async () => {
  env = await setup();
  ({ db, client } = env);
  owner = await makeUser(db, 'olivia', 'owner');
  otherOwner = await makeUser(db, 'oscar', 'owner');
  tenant = await makeUser(db, 'tina', 'tenant');
  otherTenant = await makeUser(db, 'tom', 'tenant');
  property = await makeProperty(db, owner, { name: 'Sunrise Apartments' });
  unit = await makeUnit(db, property, { name: 'Unit 1', rent: 10000 });
});
afterEach(() => env.close());

const count = async (table) => (await db.get(`SELECT COUNT(*) AS n FROM ${table}`)).n;
const unitData = (overrides = {}) => ({
  name: 'Unit 2', bedrooms: '1', bathrooms: '1', floor_area: '30', monthly_rent: '12000', status: 'vacant', ...overrides,
});

/** An approved tenancy with one confirmed payment, as the owner's records would have. */
async function tenancyWithPayment() {
  const app = await makeApplication(db, tenant, unit, { status: 'approved', approved_at: new Date().toISOString() });
  await db.run("UPDATE units SET status = 'occupied' WHERE id = ?", [unit.id]);
  await db.insert(
    `INSERT INTO payments (tenancy_id, amount, method, paid_on, status, recorded_by_id, created_at)
     VALUES (?, 1000000, 'cash', ?, 'confirmed', ?, ?)`,
    [app.id, today(), owner.id, new Date().toISOString()],
  );
  return app;
}

describe('valid input', () => {
  it('an owner adds a unit and gets a success message', async () => {
    await client.login(owner);
    const response = await client.post(`/owner/properties/${property.id}/units/`, unitData());
    assert.equal(response.status, 201);
    assert.match(response.json.message, /Unit 2/);
    const saved = await db.get("SELECT * FROM units WHERE name = 'Unit 2'");
    assert.equal(saved.monthly_rent, 1200000); // stored in centavos
  });
});

describe('invalid input is rejected on the server', () => {
  it('missing and negative values return field errors and save nothing', async () => {
    await client.login(owner);
    const before = await count('units');
    const response = await client.post(`/owner/properties/${property.id}/units/`,
      unitData({ name: '', monthly_rent: '-500', bedrooms: 'abc' }));
    assert.equal(response.status, 400);
    assert.equal(response.json.message, 'Please fix the errors below.');
    assert.ok(response.json.errors.name);
    assert.ok(response.json.errors.monthly_rent);
    assert.ok(response.json.errors.bedrooms);
    assert.equal(await count('units'), before);
  });

  it('a duplicate unit name in the same property is refused', async () => {
    await client.login(owner);
    const response = await client.post(`/owner/properties/${property.id}/units/`, unitData({ name: 'unit 1' }));
    assert.equal(response.status, 400);
    assert.match(response.json.errors.name[0], /already has a unit/);
  });

  it('a move-in date in the past is refused', async () => {
    await client.login(tenant);
    const response = await client.post(`/browse/${property.id}/apply/`,
      { unit: String(unit.id), preferred_move_in: addDays(today(), -1) });
    assert.equal(response.status, 400);
    assert.match(response.json.errors.preferred_move_in[0], /past/);
    assert.equal(await count('applications'), 0);
  });

  it('no double booking: a second tenant cannot be approved for an occupied unit', async () => {
    const first = await makeApplication(db, tenant, unit);
    const second = await makeApplication(db, otherTenant, unit);
    await client.login(owner);
    assert.equal((await client.post(`/owner/applications/${first.id}/approve/`)).status, 200);
    // Approving one tenant closes the other applications for that unit...
    const response = await client.post(`/owner/applications/${second.id}/approve/`);
    assert.equal(response.status, 400);
    assert.notEqual((await reload(db, 'applications', second)).status, 'approved');
    assert.equal((await db.get("SELECT COUNT(*) AS n FROM applications WHERE unit_id = ? AND status = 'approved'", [unit.id])).n, 1);
  });

  it('no double booking: a pending application cannot be approved once the unit is occupied', async () => {
    const app = await makeApplication(db, tenant, unit);
    await db.run("UPDATE units SET status = 'occupied' WHERE id = ?", [unit.id]);
    await client.login(owner);
    const response = await client.post(`/owner/applications/${app.id}/approve/`);
    assert.equal(response.status, 400);
    assert.match(response.json.message, /already occupied/);
    assert.equal((await reload(db, 'applications', app)).status, 'pending');
  });
});

describe('login required', () => {
  it('every core feature answers 401 when signed out', async () => {
    for (const [method, url] of [
      ['GET', '/owner/properties/'], ['POST', '/owner/properties/'], ['GET', `/owner/properties/${property.id}/`],
      ['GET', '/browse/'], ['GET', '/applications/'], ['GET', '/payments/'], ['GET', '/owner/payments/'],
      ['GET', '/profile/'], ['GET', '/dashboard/'],
    ]) {
      const response = await client.request(method, url, method === 'GET' ? {} : { json: {} });
      assert.equal(response.status, 401, `${method} ${url}`);
    }
  });
});

describe('roles are checked on the server, not only in the menu', () => {
  it('a tenant cannot use owner or admin endpoints', async () => {
    await client.login(tenant);
    assert.equal((await client.post('/owner/properties/', { name: 'Mine now' })).status, 403);
    assert.equal((await client.get('/admin/users/')).status, 403);
    assert.equal(await count('properties'), 1);
  });
});

describe("blocked access to another user's record", () => {
  it("an owner cannot view, edit, or delete another owner's property by changing the ID", async () => {
    await client.login(otherOwner);
    assert.equal((await client.get(`/owner/properties/${property.id}/`)).status, 404);
    assert.equal((await client.put(`/owner/properties/${property.id}/`, { name: 'Hijacked' })).status, 404);
    assert.equal((await client.delete(`/owner/properties/${property.id}/`)).status, 404);
    assert.equal((await client.delete(`/owner/units/${unit.id}/`)).status, 404);
    assert.equal((await reload(db, 'properties', property)).name, 'Sunrise Apartments');
    assert.ok(await reload(db, 'units', unit));
  });

  it("a tenant cannot open another tenant's application or statement", async () => {
    const app = await tenancyWithPayment();
    await client.login(otherTenant);
    assert.equal((await client.get(`/applications/${app.id}/`)).status, 404);
    assert.equal((await client.get(`/payments/${app.id}/statement/`)).status, 404);
    await client.login(tenant);
    assert.equal((await client.get(`/payments/${app.id}/statement/`)).status, 200);
  });
});

describe('invalid URLs and IDs do not crash the system', () => {
  it('answers 404 for bad, negative, huge, and unknown IDs and unknown API paths', async () => {
    await client.login(owner);
    for (const url of ['/owner/properties/abc/', '/owner/properties/-1/', '/owner/properties/99999999999999999999/',
      '/owner/properties/999/', '/owner/units/0/', '/payments/1.5/statement/', '/no-such-endpoint/']) {
      const response = await client.get(url);
      assert.equal(response.status, 404, url);
      assert.equal(typeof response.json.message, 'string');
    }
  });
});

describe('CSRF and safe methods', () => {
  it('a POST without the CSRF token is refused', async () => {
    await client.login(owner);
    const response = await client.request('POST', `/owner/properties/${property.id}/units/`, { json: unitData(), csrf: false });
    assert.equal(response.status, 403);
    assert.equal(await count('units'), 1);
  });

  it('delete endpoints do not accept GET', async () => {
    await client.login(owner);
    const expense = await db.insert(
      "INSERT INTO expenses (property_id, category, amount, spent_on, created_at) VALUES (?, 'repairs', 500, ?, ?)",
      [property.id, today(), new Date().toISOString()],
    );
    const response = await client.get(`/owner/expenses/${expense}/`);
    assert.equal(response.status, 405);
    assert.ok(await db.get('SELECT id FROM expenses WHERE id = ?', [expense]));
  });
});

describe('data integrity: records with payments are protected from deletion', () => {
  it('a unit or property with a tenancy and payments cannot be deleted', async () => {
    await tenancyWithPayment();
    await client.login(owner);
    let response = await client.delete(`/owner/units/${unit.id}/`);
    assert.equal(response.status, 400);
    assert.match(response.json.message, /can't be deleted/);
    response = await client.delete(`/owner/properties/${property.id}/`);
    assert.equal(response.status, 400);
    assert.equal(await count('payments'), 1);
    assert.ok(await reload(db, 'units', unit));
  });

  it('a unit with only pending applications can still be deleted', async () => {
    await makeApplication(db, tenant, unit);
    await client.login(owner);
    const response = await client.delete(`/owner/units/${unit.id}/`);
    assert.equal(response.status, 200);
    assert.equal(await count('units'), 0);
    assert.equal(await count('applications'), 0);
  });

  it('the database itself refuses negative amounts', async () => {
    const app = await tenancyWithPayment();
    await assert.rejects(db.insert(
      `INSERT INTO payments (tenancy_id, amount, method, paid_on, status, created_at)
       VALUES (?, -100, 'cash', ?, 'confirmed', ?)`, [app.id, today(), new Date().toISOString()],
    ), /CHECK constraint/);
  });
});

describe('500 errors', () => {
  const fakeResponse = () => {
    const res = { statusCode: 0, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
  };

  it('hide the error details unless DEBUG is on in .env', (t) => {
    t.mock.method(console, 'error', () => {});
    const saved = config.debug;
    try {
      config.debug = false;
      let res = fakeResponse();
      apiErrorHandler(new Error('secret table detail'), {}, res);
      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.body, { message: 'Something went wrong on the server. Please try again.' });

      config.debug = true;
      res = fakeResponse();
      apiErrorHandler(new Error('secret table detail'), {}, res);
      assert.equal(res.body.debug, 'secret table detail');
      assert.equal(res.body.stack, undefined);
    } finally {
      config.debug = saved;
    }
  });
});
