import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../src/db.js';
import { makeUser, PASSWORD, reload, setup } from './helpers.js';

let env;
let db;
let client;
beforeEach(async () => {
  env = await setup();
  ({ db, client } = env);
});
afterEach(() => env.close());

const signupData = (overrides = {}) => ({
  first_name: 'Juan', last_name: 'Dela Cruz', username: 'juan', email: 'juan@example.com', phone: '0917',
  role: 'tenant', password1: PASSWORD, password2: PASSWORD, ...overrides,
});
const register = (overrides) => client.post('/auth/register/', signupData(overrides));
const login = (username = 'juan', c = client) => c.post('/auth/login/', { username, password: PASSWORD });
const findJuan = () => db.get("SELECT * FROM users WHERE username = 'juan'");

describe('email verification', () => {
  it('emails a link when you sign up, with your name made safe for HTML', async () => {
    await register({ first_name: '<b>Juan</b>' });
    assert.equal(env.emails.length, 1);
    const [email] = env.emails;
    assert.equal(email.to, 'juan@example.com');
    assert.match(email.text, /https:\/\/rentease\.test\/verify-email\?token=[\w-]{43}/);
    assert.ok(email.html.includes('&lt;b&gt;Juan&lt;/b&gt;'));
    assert.ok(!email.html.includes('<b>Juan</b>'));
  });

  it("won't sign you in until the email is verified, then will", async () => {
    await register();
    const blocked = await login();
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.code, 'email_unverified');
    assert.match(blocked.json.message, /verify your email/);
    assert.equal(client.cookies.sessionid, undefined);

    const verified = await client.post('/auth/verify-email/', { token: env.tokenFor('juan@example.com') });
    assert.equal(verified.status, 200);
    assert.match(verified.json.message, /Email verified/);
    assert.equal((await login()).status, 200);
    assert.equal((await client.get('/profile/')).json.user.email_verified, true);
  });

  it('only says "unverified" after the right password', async () => {
    await register();
    const wrong = await client.post('/auth/login/', { username: 'juan', password: 'wrong-password' });
    assert.equal(wrong.status, 400);
    assert.ok(!wrong.json.code);
  });

  it('each link works once, and only for its own account', async () => {
    await register();
    const token = env.tokenFor('juan@example.com');
    assert.equal((await client.post('/auth/verify-email/', { token })).status, 200);
    assert.equal((await client.post('/auth/verify-email/', { token })).status, 400);
    for (const bad of ['', 'x', 'a'.repeat(43), { $ne: null }, null]) {
      assert.equal((await client.post('/auth/verify-email/', { token: bad })).status, 400);
    }
  });

  it('expired links are refused', async () => {
    await register();
    await db.run("UPDATE email_tokens SET expires_at = '2000-01-01T00:00:00.000Z'");
    assert.equal((await client.post('/auth/verify-email/', { token: env.tokenFor('juan@example.com') })).status, 400);
    assert.equal((await findJuan()).email_verified_at, null);
  });

  it('stores only a hash of the link token', async () => {
    await register();
    const stored = await db.get('SELECT id FROM email_tokens');
    assert.notEqual(stored.id, env.tokenFor('juan@example.com'));
  });

  it('resends a link (replacing the old one) without revealing which accounts exist', async () => {
    await register();
    const first = env.tokenFor('juan@example.com');
    const known = await client.post('/auth/resend-verification/', { username: 'juan' });
    const unknown = await client.post('/auth/resend-verification/', { username: 'nobody@example.com' });
    assert.equal(known.status, 200);
    assert.equal(known.json.message, unknown.json.message);
    assert.equal(env.emails.length, 2); // nothing sent for the unknown account
    assert.equal((await client.post('/auth/verify-email/', { token: first })).status, 400); // old link replaced
    assert.equal((await client.post('/auth/verify-email/', { token: env.tokenFor('juan@example.com') })).status, 200);
  });

  it("doesn't email verified accounts again, and limits resends", async () => {
    await makeUser(db, 'tina', 'tenant');
    await client.post('/auth/resend-verification/', { username: 'tina' });
    assert.equal(env.emails.length, 0);
    await register();
    for (let i = 0; i < 3; i += 1) await client.post('/auth/resend-verification/', { username: 'juan' });
    const limited = await client.post('/auth/resend-verification/', { username: 'juan' });
    assert.equal(limited.status, 429);
  });

  it('changing your email needs the new address verified; old links stop working', async () => {
    await register();
    const oldLink = env.tokenFor('juan@example.com');
    await client.post('/auth/verify-email/', { token: oldLink });
    await login();
    await client.postForm('/profile/', { first_name: 'Juan', last_name: 'Cruz', email: 'juan@example.com' });
    assert.equal(env.emails.length, 1); // same email: nothing to verify
    const changed = await client.postForm('/profile/', { first_name: 'Juan', last_name: 'Cruz', email: 'new@example.com' });
    assert.equal(changed.json.user.email_verified, false);
    assert.equal(env.emails.at(-1).to, 'new@example.com');
    await client.post('/auth/logout/');
    assert.equal((await login('juan')).json.code, 'email_unverified');
    assert.equal((await client.post('/auth/verify-email/', { token: env.tokenFor('new@example.com') })).status, 200);
    assert.equal((await login('new@example.com')).status, 200);
  });

  it('still creates the account if the email can’t be sent', async () => {
    await env.close();
    env = await setup({ mailer: { send: async () => { throw new Error('Resend is down'); } } });
    ({ db, client } = env);
    const response = await register();
    assert.equal(response.status, 201);
    assert.match(response.json.message, /couldn’t send the verification email/);
    assert.ok(await findJuan());
  });

  it('accounts made by admins, scripts, and seed data are already verified', async () => {
    const admin = await makeUser(db, 'root', 'admin');
    await client.login(admin);
    await client.post('/admin/users/', signupData({ username: 'ana', email: 'ana@example.com', role: 'manager' }));
    assert.ok((await db.get("SELECT email_verified_at FROM users WHERE username = 'ana'")).email_verified_at);
    assert.equal(env.emails.length, 0);
  });

  it('admins can mark an email verified, but not unverify their own', async () => {
    const admin = await makeUser(db, 'root', 'admin');
    await register();
    const juan = await findJuan();
    await client.login(admin);
    const edit = (user, extra) => client.put(`/admin/users/${user.id}/`, {
      first_name: user.first_name, last_name: user.last_name, email: user.email, phone: user.phone, role: user.role,
      is_active: true, ...extra,
    });
    await edit(juan, { email_verified: true });
    assert.ok((await reload(db, 'users', juan)).email_verified_at);
    const self = await edit(admin, { email_verified: false });
    assert.ok(self.json.errors.email_verified);
  });
});

describe('upgrading an existing database', () => {
  it('adds the column and counts existing accounts as verified', async () => {
    const old = await openDatabase({ url: '', sqlitePath: ':memory:' });
    // Rebuild the users table as it was before email verification existed.
    old.conn.exec(`PRAGMA foreign_keys = OFF; DROP TABLE users;
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, email TEXT NOT NULL,
        password TEXT NOT NULL, first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'tenant', phone TEXT NOT NULL DEFAULT '', profile_photo TEXT NOT NULL DEFAULT '',
        gcash_name TEXT NOT NULL DEFAULT '', gcash_number TEXT NOT NULL DEFAULT '', gcash_qr TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1, date_joined TEXT NOT NULL, last_login TEXT);
      INSERT INTO users (username, email, password, date_joined) VALUES ('old', 'old@example.com', 'x', '2026-01-01T00:00:00.000Z');`);
    await old.migrate();
    assert.equal((await old.get("SELECT email_verified_at FROM users WHERE username = 'old'")).email_verified_at,
      '2026-01-01T00:00:00.000Z');
    await old.migrate(); // running again changes nothing
    await old.close();
  });
});
