import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { checkPassword } from '../src/lib/passwords.js';
import { makeUser, PASSWORD, reload, setup } from './helpers.js';

let env;
let db;
let client;
let admin;
let tenant;

beforeEach(async () => {
  env = await setup();
  ({ db, client } = env);
  admin = await makeUser(db, 'root', 'admin');
  tenant = await makeUser(db, 'tina', 'tenant');
  await client.login(admin);
});
afterEach(() => env.close());

const newAccount = (overrides = {}) => ({
  first_name: 'Ana', last_name: 'Reyes', username: 'ana', email: 'ana@example.com', phone: '0917',
  role: 'staff', password1: PASSWORD, password2: PASSWORD, ...overrides,
});
const edit = (user, overrides = {}) => ({
  first_name: user.first_name, last_name: user.last_name, email: user.email, phone: user.phone, role: user.role,
  is_active: Boolean(user.is_active), ...overrides,
});

describe('users & access', () => {
  it('is admin only', async () => {
    await client.login(tenant);
    assert.equal((await client.get('/admin/users/')).status, 403);
    assert.equal((await client.post('/admin/users/', newAccount())).status, 403);
  });

  it('lists, searches, and filters users', async () => {
    let { json } = await client.get('/admin/users/');
    assert.deepEqual(new Set(json.users.map((u) => u.username)), new Set(['root', 'tina']));
    assert.equal(json.role_tabs.find((t) => t.value === 'tenant').count, 1);
    ({ json } = await client.get('/admin/users/', { q: 'TIN' }));
    assert.deepEqual(json.users.map((u) => u.username), ['tina']);
    ({ json } = await client.get('/admin/users/', { role: 'admin' }));
    assert.deepEqual(json.users.map((u) => u.username), ['root']);
  });

  it('creates Staff and Admin accounts', async () => {
    const response = await client.post('/admin/users/', newAccount());
    assert.equal(response.status, 201);
    const user = await db.get("SELECT * FROM users WHERE username = 'ana'");
    assert.equal(user.role, 'staff');
    assert.ok(await checkPassword(PASSWORD, user.password));
    const dupe = await client.post('/admin/users/', newAccount({ email: 'other@example.com' }));
    assert.deepEqual(dupe.json.errors.username, ['This username is already taken.']);
  });

  it('changes a role, resets a password, and signs the user out', async () => {
    const other = env.newClient();
    await other.login(tenant);
    const response = await client.put(`/admin/users/${tenant.id}/`, edit(tenant, {
      role: 'owner', password1: 'N3w-Secret-99', password2: 'N3w-Secret-99' }));
    assert.equal(response.status, 200);
    const fresh = await reload(db, 'users', tenant);
    assert.equal(fresh.role, 'owner');
    assert.ok(await checkPassword('N3w-Secret-99', fresh.password));
    assert.equal((await other.get('/profile/')).status, 401);
  });

  it('deactivates an account, which then cannot sign in', async () => {
    await client.put(`/admin/users/${tenant.id}/`, edit(tenant, { is_active: false }));
    assert.equal((await reload(db, 'users', tenant)).is_active, 0);
    const other = env.newClient();
    assert.equal((await other.post('/auth/login/', { username: 'tina', password: PASSWORD })).status, 400);
  });

  it("doesn't let admins lock themselves out", async () => {
    const response = await client.put(`/admin/users/${admin.id}/`, edit(admin, { role: 'staff', is_active: false }));
    assert.equal(response.status, 400);
    assert.ok(response.json.errors.role);
    assert.ok(response.json.errors.is_active);
    assert.equal((await reload(db, 'users', admin)).role, 'admin');
  });

  it('leaves the password alone when none is given', async () => {
    await client.put(`/admin/users/${tenant.id}/`, edit(tenant, { phone: '0999' }));
    assert.ok(await checkPassword(PASSWORD, (await reload(db, 'users', tenant)).password));
  });
});
