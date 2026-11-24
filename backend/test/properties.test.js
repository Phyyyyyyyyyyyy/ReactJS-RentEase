import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { addDays, today } from '../src/lib/format.js';
import { makeApplication, makeProperty, makeUnit, makeUser, reload, setup } from './helpers.js';

let env;
let db;
let client;
let owner;
let tenant;
let apt;
let vacant;
let occupied;
let studio;
let studioUnit;

beforeEach(async () => {
  env = await setup();
  ({ db, client } = env);
  owner = await makeUser(db, 'owner', 'owner');
  tenant = await makeUser(db, 'tenant', 'tenant');
  apt = await makeProperty(db, owner, { name: 'Lahug Apartments', property_type: 'apartment', address: 'Salinas Dr', amenities: 'Wi-Fi, Parking' });
  vacant = await makeUnit(db, apt, { name: '101', rent: 8500 });
  occupied = await makeUnit(db, apt, { name: '102', rent: 9000, status: 'occupied' });
  studio = await makeProperty(db, owner, { name: 'Mabolo Studios', property_type: 'studio', address: 'MJ Cuenco' });
  studioUnit = await makeUnit(db, studio, { name: '3A', rent: 15000 });
  const full = await makeProperty(db, owner, { name: 'Full House', property_type: 'house', address: 'Banilad' });
  await makeUnit(db, full, { name: 'Main', rent: 20000, status: 'occupied' });
  await client.login(tenant);
});
afterEach(() => env.close());

const count = async (sql, params = []) => (await db.get(sql, params)).n;

describe('tenant access', () => {
  it('is tenant only', async () => {
    const urls = ['/browse/', `/browse/${apt.id}/`, '/applications/'];
    await client.login(owner);
    for (const url of urls) assert.equal((await client.get(url)).status, 403, url);
    client.logout();
    for (const url of urls) assert.equal((await client.get(url)).status, 401, url);
  });
});

describe('browse', () => {
  const names = async (query) => {
    const response = await client.get('/browse/', query);
    assert.equal(response.status, 200);
    return new Set(response.json.properties.map((p) => p.name));
  };

  it('lists only properties with a vacant unit', async () => {
    assert.deepEqual(await names(), new Set(['Lahug Apartments', 'Mabolo Studios']));
  });

  it('searches and filters by type and maximum rent', async () => {
    assert.deepEqual(await names({ q: 'mabolo' }), new Set(['Mabolo Studios']));
    assert.deepEqual(await names({ q: 'SALINAS' }), new Set(['Lahug Apartments']));
    assert.deepEqual(await names({ q: '100%' }), new Set());
    assert.deepEqual(await names({ type: 'apartment' }), new Set(['Lahug Apartments']));
    assert.deepEqual(await names({ max_rent: '10000' }), new Set(['Lahug Apartments']));
    assert.deepEqual(await names({ max_rent: '1000' }), new Set());
  });

  it('ignores an invalid maximum rent', async () => {
    assert.deepEqual(await names({ max_rent: 'abc' }), new Set(['Lahug Apartments', 'Mabolo Studios']));
    assert.equal((await client.get('/browse/', { max_rent: 'abc' })).json.invalid_filter, true);
  });

  it('shows the vacant count and starting rent', async () => {
    const { json } = await client.get('/browse/');
    const listing = json.properties.find((p) => p.name === 'Lahug Apartments');
    assert.deepEqual([listing.vacant_count, listing.min_rent, listing.amenity_list], [1, '8500.00', ['Wi-Fi', 'Parking']]);
  });
});

describe('apply', () => {
  const apply = (unit, extra = {}) => client.post(`/browse/${apt.id}/apply/`, { unit: unit.id, message: 'Hi', ...extra });

  it('lists the units on the detail page', async () => {
    const { json } = await client.get(`/browse/${apt.id}/`);
    assert.deepEqual(json.units.map((u) => u.name), ['101', '102']);
    assert.equal(json.can_apply, true);
  });

  it('applies for a vacant unit', async () => {
    const response = await apply(vacant);
    assert.equal(response.status, 201);
    assert.match(response.json.message, /submitted/);
    const app = await db.get('SELECT * FROM applications');
    assert.deepEqual([app.tenant_id, app.unit_id, app.status], [tenant.id, vacant.id, 'pending']);
    assert.equal(response.json.id, app.id);
    assert.deepEqual((await client.get(`/browse/${apt.id}/`)).json.pending_unit_ids, [vacant.id]);
  });

  it("can't apply for an occupied unit", async () => {
    assert.equal((await apply(occupied)).status, 400);
    assert.equal(await count('SELECT COUNT(*) AS n FROM applications'), 0);
  });

  it("can't apply twice while pending", async () => {
    await apply(vacant);
    const response = await apply(vacant);
    assert.match(response.json.errors.non_field_errors[0], /already have a pending application/);
    assert.equal(await count('SELECT COUNT(*) AS n FROM applications'), 1);
  });

  it('needs a unit of this property', async () => {
    await apply(studioUnit);
    assert.equal(await count('SELECT COUNT(*) AS n FROM applications'), 0);
    const missing = await client.post(`/browse/${apt.id}/apply/`, { message: 'Hi' });
    assert.deepEqual(missing.json.errors.unit, ['Please choose a vacant unit.']);
  });

  it("doesn't accept a move-in date in the past", async () => {
    const response = await apply(vacant, { preferred_move_in: addDays(today(), -1) });
    assert.match(response.json.errors.preferred_move_in[0], /cannot be in the past/);
    assert.equal(await count('SELECT COUNT(*) AS n FROM applications'), 0);
  });
});

describe('my applications', () => {
  let mine;
  let theirs;
  beforeEach(async () => {
    mine = await makeApplication(db, tenant, vacant);
    theirs = await makeApplication(db, await makeUser(db, 'other', 'tenant'), vacant, { message: 'SECRET-NOTE' });
  });

  it('lists only your own applications', async () => {
    const response = await client.get('/applications/');
    assert.deepEqual(response.json.applications.map((a) => a.id), [mine.id]);
    assert.ok(!response.text.includes('SECRET-NOTE'));
  });

  it('filters by status and counts each tab', async () => {
    const { json } = await client.get('/applications/', { status: 'approved' });
    assert.deepEqual(json.applications, []);
    const counts = Object.fromEntries(json.status_tabs.map((t) => [t.value, t.count]));
    assert.deepEqual([counts[''], counts.pending, counts.approved], [1, 1, 0]);
  });

  it('withdraws your own pending application', async () => {
    assert.match((await client.post(`/applications/${mine.id}/withdraw/`)).json.message, /withdrawn/);
    assert.equal((await reload(db, 'applications', mine)).status, 'withdrawn');
  });

  it("can't withdraw someone else's", async () => {
    assert.equal((await client.post(`/applications/${theirs.id}/withdraw/`)).status, 404);
    assert.equal((await reload(db, 'applications', theirs)).status, 'pending');
  });

  it('withdraw needs POST', async () => {
    assert.equal((await client.get(`/applications/${mine.id}/withdraw/`)).status, 405);
  });
});

describe('edit application', () => {
  let mine;
  let theirs;
  beforeEach(async () => {
    mine = await makeApplication(db, tenant, vacant);
    theirs = await makeApplication(db, await makeUser(db, 'other', 'tenant'), vacant, { message: 'SECRET-NOTE' });
  });

  it('edits your own pending application', async () => {
    const moveIn = addDays(today(), 14);
    const response = await client.put(`/applications/${mine.id}/`, { preferred_move_in: moveIn, message: 'Updated note' });
    assert.match(response.json.message, /updated/);
    const fresh = await reload(db, 'applications', mine);
    assert.deepEqual([fresh.preferred_move_in, fresh.message], [moveIn, 'Updated note']);
  });

  it('rejects a past move-in date', async () => {
    const response = await client.put(`/applications/${mine.id}/`, { preferred_move_in: addDays(today(), -1), message: 'x' });
    assert.match(response.json.errors.preferred_move_in[0], /cannot be in the past/);
    assert.equal((await reload(db, 'applications', mine)).preferred_move_in, null);
  });

  it("can't see or edit someone else's", async () => {
    assert.equal((await client.get(`/applications/${theirs.id}/`)).status, 404);
    assert.equal((await client.put(`/applications/${theirs.id}/`, { message: 'hacked' })).status, 404);
    assert.equal((await reload(db, 'applications', theirs)).message, 'SECRET-NOTE');
  });

  it('only edits pending applications', async () => {
    await db.run("UPDATE applications SET status = 'rejected' WHERE id = ?", [mine.id]);
    const response = await client.put(`/applications/${mine.id}/`, { message: 'too late' });
    assert.match(response.json.message, /Only pending applications can be edited/);
    assert.equal((await reload(db, 'applications', mine)).message, '');
  });

  it("owners can't use the tenant endpoint", async () => {
    await client.login(owner);
    assert.equal((await client.get(`/applications/${mine.id}/`)).status, 403);
  });
});

// ------------------------------------------------------------------- owner

describe('owner', () => {
  let otherOwner;
  let theirs;
  let theirUnit;
  beforeEach(async () => {
    otherOwner = await makeUser(db, 'other', 'owner');
    theirs = await makeProperty(db, otherOwner, { name: 'Not Mine', property_type: 'house', address: 'Talamban' });
    theirUnit = await makeUnit(db, theirs, { name: 'A', rent: 5000 });
    await client.login(owner);
  });

  const propertyData = (overrides = {}) => ({
    name: 'Banilad Homes', property_type: 'house', address: 'Gov. Cuenco', city: 'Cebu City', description: '',
    amenities: '', ...overrides,
  });

  describe('access', () => {
    it('owner endpoints are owner only', async () => {
      await client.login(tenant);
      for (const url of ['/owner/properties/', '/owner/applications/', `/owner/properties/${apt.id}/`]) {
        assert.equal((await client.get(url)).status, 403, url);
      }
    });

    it('lists only your own properties, with counts', async () => {
      const { json } = await client.get('/owner/properties/');
      const props = Object.fromEntries(json.properties.map((p) => [p.name, p]));
      assert.deepEqual(new Set(Object.keys(props)), new Set(['Lahug Apartments', 'Mabolo Studios', 'Full House']));
      assert.deepEqual([props['Lahug Apartments'].unit_count, props['Lahug Apartments'].vacant_count], [2, 1]);
    });

    it("can't touch another owner's property or unit", async () => {
      assert.equal((await client.get(`/owner/properties/${theirs.id}/`)).status, 404);
      assert.equal((await client.put(`/owner/properties/${theirs.id}/`, propertyData())).status, 404);
      assert.equal((await client.post(`/owner/properties/${theirs.id}/units/`, {})).status, 404);
      assert.equal((await client.get(`/owner/units/${theirUnit.id}/`)).status, 404);
      assert.equal((await client.delete(`/owner/properties/${theirs.id}/`)).status, 404);
      assert.equal((await client.delete(`/owner/units/${theirUnit.id}/`)).status, 404);
      assert.ok(await reload(db, 'properties', theirs));
      assert.ok(await reload(db, 'units', theirUnit));
    });
  });

  describe('properties', () => {
    it('creates a property owned by you', async () => {
      const response = await client.post('/owner/properties/', propertyData());
      assert.equal(response.status, 201);
      const prop = await db.get("SELECT * FROM properties WHERE name = 'Banilad Homes'");
      assert.deepEqual([prop.owner_id, response.json.property.id], [owner.id, prop.id]);
    });

    it('requires the fields', async () => {
      const response = await client.post('/owner/properties/', { name: '' });
      assert.equal(response.status, 400);
      assert.ok(response.json.errors.name);
    });

    it('edits and deletes a property', async () => {
      await client.put(`/owner/properties/${studio.id}/`, propertyData({ name: 'Mabolo Lofts', property_type: 'studio', address: 'MJ Cuenco' }));
      assert.equal((await reload(db, 'properties', studio)).name, 'Mabolo Lofts');
      await client.delete(`/owner/properties/${studio.id}/`);
      assert.equal(await reload(db, 'properties', studio), undefined);
      assert.equal(await reload(db, 'units', studioUnit), undefined); // its units go too
    });

    it('rejects a duplicate property', async () => {
      const response = await client.post('/owner/properties/', propertyData({
        name: ' lahug apartments ', property_type: 'apartment', address: 'SALINAS DR', city: 'cebu city' }));
      assert.equal(response.status, 400);
      assert.ok(response.json.errors.non_field_errors.includes('You already have a property with this name at this address.'));
      assert.equal(await count("SELECT COUNT(*) AS n FROM properties WHERE owner_id = ? AND LOWER(name) = 'lahug apartments'", [owner.id]), 1);
    });

    it('rejects editing into a duplicate', async () => {
      const response = await client.put(`/owner/properties/${studio.id}/`, propertyData({
        name: 'Lahug Apartments', property_type: 'studio', address: 'Salinas Dr' }));
      assert.equal(response.status, 400);
      assert.equal((await reload(db, 'properties', studio)).name, 'Mabolo Studios');
    });

    it('allows the same name at another address or for another owner', async () => {
      await client.post('/owner/properties/', propertyData({ name: 'Lahug Apartments', address: 'Gorordo Ave' }));
      await client.login(otherOwner);
      await client.post('/owner/properties/', propertyData({ name: 'Lahug Apartments', address: 'Salinas Dr' }));
      assert.equal(await count("SELECT COUNT(*) AS n FROM properties WHERE name = 'Lahug Apartments'"), 3);
    });

    it('saving an unchanged property is not a duplicate', async () => {
      const response = await client.put(`/owner/properties/${apt.id}/`, propertyData({
        name: 'Lahug Apartments', property_type: 'apartment', address: 'Salinas Dr', description: 'Updated' }));
      assert.equal(response.status, 200);
    });
  });

  describe('units', () => {
    const unitData = (overrides = {}) => ({
      name: '201', bedrooms: 1, bathrooms: 1, floor_area: 30, monthly_rent: 9500, status: 'vacant', ...overrides,
    });

    it('adds a unit', async () => {
      assert.equal((await client.post(`/owner/properties/${apt.id}/units/`, unitData())).status, 201);
      assert.equal(await count("SELECT COUNT(*) AS n FROM units WHERE property_id = ? AND name = '201' AND monthly_rent = 950000", [apt.id]), 1);
    });

    it('accepts centavos', async () => {
      const response = await client.post(`/owner/properties/${apt.id}/units/`, unitData({ monthly_rent: '9500.50' }));
      assert.equal(response.json.unit.monthly_rent, '9500.50');
      const bad = await client.post(`/owner/properties/${apt.id}/units/`, unitData({ name: '202', monthly_rent: '1.234' }));
      assert.deepEqual(bad.json.errors.monthly_rent, ['Ensure that there are no more than 2 decimal places.']);
    });

    it('rejects a duplicate unit name', async () => {
      const response = await client.post(`/owner/properties/${apt.id}/units/`, unitData({ name: '101' }));
      assert.ok(response.json.errors.name);
    });

    it('allows the same unit name in another property', async () => {
      await client.post(`/owner/properties/${studio.id}/units/`, unitData({ name: '101' }));
      assert.equal(await count("SELECT COUNT(*) AS n FROM units WHERE property_id = ? AND name = '101'", [studio.id]), 1);
    });

    it('needs a rent above zero', async () => {
      const response = await client.post(`/owner/properties/${apt.id}/units/`, unitData({ monthly_rent: 0 }));
      assert.ok(response.json.errors.monthly_rent);
    });

    it('edits a unit keeping its name, then deletes it', async () => {
      await client.put(`/owner/units/${vacant.id}/`, unitData({ name: '101', status: 'occupied' }));
      assert.equal((await reload(db, 'units', vacant)).status, 'occupied');
      await client.delete(`/owner/units/${vacant.id}/`);
      assert.equal(await reload(db, 'units', vacant), undefined);
    });
  });

  describe('applications', () => {
    let app1;
    let app2;
    let theirApp;
    beforeEach(async () => {
      app1 = await makeApplication(db, tenant, vacant);
      app2 = await makeApplication(db, await makeUser(db, 'tenant2', 'tenant'), vacant);
      theirApp = await makeApplication(db, tenant, theirUnit);
    });
    const decide = (app, decision) => client.post(`/owner/applications/${app.id}/${decision}/`);

    it('lists only applications for your own units', async () => {
      const { json } = await client.get('/owner/applications/');
      assert.equal(json.status, 'pending');
      assert.deepEqual(new Set(json.applications.map((a) => a.id)), new Set([app1.id, app2.id]));
      assert.ok('email' in json.applications[0].tenant); // owners see tenant contact details
    });

    it('approving occupies the unit and rejects the others', async () => {
      assert.match((await decide(app1, 'approve')).json.message, /1 other pending application was rejected/);
      assert.deepEqual(
        [(await reload(db, 'applications', app1)).status, (await reload(db, 'applications', app2)).status,
          (await reload(db, 'units', vacant)).status],
        ['approved', 'rejected', 'occupied'],
      );
    });

    it('rejects', async () => {
      await decide(app1, 'reject');
      assert.equal((await reload(db, 'applications', app1)).status, 'rejected');
      assert.equal((await reload(db, 'units', vacant)).status, 'vacant');
    });

    it("can't approve for an occupied unit", async () => {
      await db.run("UPDATE units SET status = 'occupied' WHERE id = ?", [vacant.id]);
      assert.equal((await decide(app1, 'approve')).status, 400);
      assert.equal((await reload(db, 'applications', app1)).status, 'pending');
    });

    it('only decides pending applications', async () => {
      await db.run("UPDATE applications SET status = 'withdrawn' WHERE id = ?", [app1.id]);
      await decide(app1, 'approve');
      assert.equal((await reload(db, 'applications', app1)).status, 'withdrawn');
      assert.equal((await reload(db, 'units', vacant)).status, 'vacant');
    });

    it("can't decide another owner's application", async () => {
      assert.equal((await decide(theirApp, 'approve')).status, 404);
      assert.equal((await reload(db, 'applications', theirApp)).status, 'pending');
    });

    it('an unknown decision is a 404', async () => {
      assert.equal((await client.post(`/owner/applications/${app1.id}/delete/`)).status, 404);
    });

    it('counts pending applications in the sidebar badge', async () => {
      assert.equal((await client.get('/badges/')).json.pending_applications, 2);
    });
  });
});
