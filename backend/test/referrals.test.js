import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { generateCode } from '../src/referrals.js';
import { makeUser, PASSWORD, setup } from './helpers.js';

let env;
let db;
let client;
let admin;

beforeEach(async () => {
  env = await setup({ limits: { badCodesPerAddress: { limit: 3, windowMs: 60_000 } } });
  ({ db, client } = env);
  admin = await makeUser(db, 'root', 'admin');
  await client.login(admin);
});
afterEach(() => env.close());

const create = (body) => client.post('/admin/referral-codes/', body);
const signUp = (c, n, referral_code) => c.post('/auth/register/', {
  first_name: 'New', last_name: 'Person', username: `new${n}`, email: `new${n}@example.com`, phone: '0917',
  referral_code, password1: PASSWORD, password2: PASSWORD,
});

describe('referral codes', () => {
  it('admins generate random codes for a role', async () => {
    const response = await create({ role: 'owner', label: 'For landlords' });
    assert.equal(response.status, 201);
    const code = response.json.code;
    assert.match(code.code, /^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/);
    assert.deepEqual([code.role, code.role_display, code.label, code.is_active, code.uses], ['owner', 'Property Owner', 'For landlords', true, 0]);
    const { json } = await client.get('/admin/referral-codes/');
    assert.equal(json.codes.length, 1);
    assert.deepEqual(json.roles.map((r) => r.value), ['owner', 'tenant', 'manager']);
  });

  it('admins can choose a custom code; duplicates and bad characters are refused', async () => {
    assert.equal((await create({ role: 'tenant', code: 'lahug-2026' })).json.code.code, 'LAHUG-2026');
    assert.deepEqual((await create({ role: 'tenant', code: 'Lahug-2026' })).json.errors.code, ['That code already exists. Choose another.']);
    assert.ok((await create({ role: 'tenant', code: 'no spaces!' })).json.errors.code);
    assert.ok((await create({ role: 'tenant', code: 'ab' })).json.errors.code);
  });

  it("can't make admin codes", async () => {
    assert.ok((await create({ role: 'admin' })).json.errors.role);
    assert.ok((await create({ role: '' })).json.errors.role);
  });

  it('a code works any number of times and gives its role; disabling stops it', async () => {
    const { code } = (await create({ role: 'manager', code: 'MGR-INVITE' })).json;
    const visitor = env.newClient();
    assert.equal((await signUp(visitor, 1, 'mgr-invite')).status, 201);
    assert.equal((await signUp(visitor, 2, 'MGR-INVITE')).status, 201);
    const users = await db.all("SELECT role, referral_code_id FROM users WHERE username LIKE 'new%'");
    assert.ok(users.every((u) => u.role === 'manager' && u.referral_code_id === code.id));
    assert.equal((await client.get('/admin/referral-codes/')).json.codes[0].uses, 2);

    await client.put(`/admin/referral-codes/${code.id}/`, { is_active: false });
    assert.match((await signUp(visitor, 3, 'MGR-INVITE')).json.errors.referral_code[0], /isn’t valid/);
    await client.put(`/admin/referral-codes/${code.id}/`, { is_active: true, label: 'Back on' });
    assert.equal((await signUp(visitor, 4, 'MGR-INVITE')).status, 201);
  });

  it('only unused codes can be deleted', async () => {
    const used = (await create({ role: 'tenant', code: 'USED-ONE' })).json.code;
    const unused = (await create({ role: 'tenant', code: 'NEVER-USED' })).json.code;
    await signUp(env.newClient(), 1, 'USED-ONE');
    assert.equal((await client.delete(`/admin/referral-codes/${used.id}/`)).status, 400);
    assert.equal((await client.delete(`/admin/referral-codes/${unused.id}/`)).status, 200);
    assert.deepEqual((await client.get('/admin/referral-codes/')).json.codes.map((c) => c.code), ['USED-ONE']);
  });

  it('guessing codes is cut off', async () => {
    await create({ role: 'tenant', code: 'REAL-CODE' });
    const guesser = env.newClient();
    for (let i = 0; i < 3; i += 1) assert.equal((await signUp(guesser, i, `GUESS-${i}`)).status, 400);
    assert.equal((await signUp(guesser, 9, 'REAL-CODE')).status, 429);
  });

  it('only admins manage codes', async () => {
    for (const role of ['owner', 'tenant', 'manager']) {
      await client.login(await makeUser(db, `u_${role}`, role));
      assert.equal((await client.get('/admin/referral-codes/')).status, 403);
      assert.equal((await create({ role: 'tenant' })).status, 403);
    }
  });

  it('random codes are unpredictable and easy to read', () => {
    const codes = new Set(Array.from({ length: 200 }, generateCode));
    assert.equal(codes.size, 200);
    for (const code of codes) assert.doesNotMatch(code, /[01ILO]/);
  });
});
