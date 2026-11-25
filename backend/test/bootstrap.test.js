import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ensureAdmin } from '../src/bootstrap.js';
import { checkPassword } from '../src/lib/passwords.js';
import { createSessionToken } from '../src/lib/auth.js';
import { makeUser, setup } from './helpers.js';

const STRONG = 'Sunrise-Lahug-2026!';
let env;
let db;
beforeEach(async () => {
  env = await setup();
  ({ db } = env);
});
afterEach(() => env.close());

const find = (username) => db.get('SELECT * FROM users WHERE username = ?', [username]);

describe('admin account from ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD', () => {
  it('does nothing when not configured', async () => {
    assert.equal(await ensureAdmin(db, {}), null);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM users')).n, 0);
  });

  it('creates the admin account, then signs in with it', async () => {
    assert.match(await ensureAdmin(db, { username: 'reuben', email: 'Reuben@Example.com', password: STRONG }), /created/);
    const admin = await find('reuben');
    assert.deepEqual([admin.role, admin.email, admin.is_active], ['admin', 'reuben@example.com', 1]);
    const response = await env.client.post('/auth/login/', { username: 'reuben', password: STRONG });
    assert.equal(response.status, 200);
    assert.equal(response.json.user.role, 'admin');
  });

  it('resets an existing account’s password, re-activates it, makes it Admin, and ends its old sessions', async () => {
    const old = await makeUser(db, 'reuben', 'tenant');
    await db.run('UPDATE users SET is_active = 0 WHERE id = ?', [old.id]);
    await createSessionToken(db, old.id);
    assert.match(await ensureAdmin(db, { username: 'Reuben', password: STRONG }), /is ready/);
    const fresh = await find('reuben');
    assert.deepEqual([fresh.role, fresh.is_active], ['admin', 1]);
    assert.ok(await checkPassword(STRONG, fresh.password));
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', [old.id])).n, 0);
  });

  it("doesn't sign the admin out on a restart when nothing changed", async () => {
    await ensureAdmin(db, { username: 'reuben', email: 'r@example.com', password: STRONG });
    const admin = await find('reuben');
    await createSessionToken(db, admin.id);
    assert.match(await ensureAdmin(db, { username: 'reuben', email: 'r@example.com', password: STRONG }), /is ready.$/);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', [admin.id])).n, 1);
  });

  it('refuses weak passwords, bad usernames, and missing or taken emails', async () => {
    assert.match(await ensureAdmin(db, { username: 'reuben', email: 'r@example.com', password: '12345678' }), /was not used/);
    assert.match(await ensureAdmin(db, { username: 'bad name!', email: 'r@example.com', password: STRONG }), /ADMIN_USERNAME/);
    assert.match(await ensureAdmin(db, { username: 'reuben', password: STRONG }), /ADMIN_EMAIL is missing/);
    await makeUser(db, 'someone', 'tenant');
    assert.match(await ensureAdmin(db, { username: 'reuben', email: 'someone@example.com', password: STRONG }), /already belongs/);
    assert.equal(await find('reuben'), undefined);
  });
});
