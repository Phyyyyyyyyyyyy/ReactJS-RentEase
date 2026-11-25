import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { checkPassword } from '../src/lib/passwords.js';
import { makeReferral, makeUser, PASSWORD, reload, setup } from './helpers.js';

let env;
let db;
let client;
beforeEach(async () => {
  env = await setup();
  ({ db, client } = env);
});
afterEach(() => env.close());

const userCount = async () => (await db.get('SELECT COUNT(*) AS n FROM users')).n;
const findByUsername = (username) => db.get('SELECT * FROM users WHERE username = ?', [username]);

describe('registration', () => {
  beforeEach(() => makeReferral(db, 'tenant', 'JOIN-TENANT'));
  const data = (overrides = {}) => ({
    first_name: 'Juan', last_name: 'Dela Cruz', username: 'juan', email: 'juan@example.com', phone: '09170000000',
    referral_code: 'JOIN-TENANT', password1: PASSWORD, password2: PASSWORD, ...overrides,
  });

  it('creates the account and hashes the password', async () => {
    const response = await client.post('/auth/register/', data());
    assert.equal(response.status, 201);
    assert.equal(response.json.message, 'Account created as Tenant. You can now sign in.');
    const user = await findByUsername('juan');
    assert.ok(user.password.startsWith('pbkdf2_sha256$'));
    assert.ok(await checkPassword(PASSWORD, user.password));
    assert.equal((await client.get('/auth/session/')).json.user, null); // signs in separately
  });

  it('requires every field', async () => {
    const response = await client.post('/auth/register/', {});
    assert.equal(response.status, 400);
    assert.ok(response.json.errors.username.includes('This field is required.'));
    assert.equal(await userCount(), 0);
  });

  it('checks the email address', async () => {
    const { json } = await client.post('/auth/register/', data({ email: 'not-an-email' }));
    assert.ok(json.errors.email.includes('Enter a valid email address.'));
  });

  it('rejects a duplicate email or username', async () => {
    await makeUser(db, 'juan', 'tenant');
    const { json } = await client.post('/auth/register/', data({ email: 'JUAN@example.com' }));
    assert.ok(json.errors.email.includes('An account with this email already exists.'));
    assert.ok(json.errors.username);
    assert.equal(await userCount(), 1);
  });

  it('rejects passwords that do not match', async () => {
    const { json } = await client.post('/auth/register/', data({ password2: 'different-Pass9' }));
    assert.ok(json.errors.password2);
    assert.equal(await findByUsername('juan'), undefined);
  });

  it('rejects weak passwords', async () => {
    const { json } = await client.post('/auth/register/', data({ password1: '12345', password2: '12345' }));
    assert.deepEqual(json.errors.password2, [
      'This password is too short. It must contain at least 8 characters.',
      'This password is too common.',
      'This password is entirely numeric.',
    ]);
    const similar = await client.post('/auth/register/', data({ password1: 'DelaCruz9!', password2: 'DelaCruz9!' }));
    assert.deepEqual(similar.json.errors.password2, ['The password is too similar to the last name.']);
  });

  it('needs a valid referral code, which decides the role', async () => {
    const missing = await client.post('/auth/register/', data({ referral_code: '' }));
    assert.deepEqual(missing.json.errors.referral_code, ['This field is required.']);
    const wrong = await client.post('/auth/register/', data({ referral_code: 'NOPE-1234' }));
    assert.match(wrong.json.errors.referral_code[0], /isn’t valid/);
    assert.equal(await findByUsername('juan'), undefined);
    // Asking for a different role is ignored: the code's role wins.
    assert.equal((await client.post('/auth/register/', data({ role: 'admin', referral_code: ' join-tenant ' }))).status, 201);
    assert.equal((await findByUsername('juan')).role, 'tenant');
  });
});

describe('sign in and out', () => {
  let user;
  beforeEach(async () => { user = await makeUser(db, 'tina', 'tenant'); });

  it('works with the username or the email', async () => {
    for (const identifier of ['tina', 'tina@example.com', 'TINA']) {
      const response = await client.post('/auth/login/', { username: identifier, password: PASSWORD });
      assert.equal(response.status, 200);
      assert.equal(response.json.user.role, 'tenant');
      assert.equal((await client.get('/auth/session/')).json.user.username, 'tina');
      await client.post('/auth/logout/');
    }
  });

  it('shows an error for wrong credentials', async () => {
    const response = await client.post('/auth/login/', { username: 'tina', password: 'wrong' });
    assert.equal(response.status, 400);
    assert.match(response.json.message, /Invalid username\/email or password/);
    assert.equal((await client.get('/auth/session/')).json.user, null);
  });

  it('refuses inactive accounts', async () => {
    await db.run('UPDATE users SET is_active = 0 WHERE id = ?', [user.id]);
    const response = await client.post('/auth/login/', { username: 'tina', password: PASSWORD });
    assert.equal(response.status, 400);
  });

  it('ends the session on sign out', async () => {
    await client.login(user);
    await client.post('/auth/logout/');
    assert.equal(client.cookies.sessionid, undefined);
    assert.equal((await client.get('/auth/session/')).json.user, null);
    assert.equal((await client.get('/profile/')).status, 401);
  });

  it('requires the CSRF token even to sign in', async () => {
    let response = await client.request('POST', '/auth/login/', { json: { username: 'tina', password: PASSWORD }, csrf: false });
    assert.equal(response.status, 403);
    // With the cookie from /auth/session/ sent back as X-CSRFToken it works.
    response = await client.post('/auth/login/', { username: 'tina', password: PASSWORD });
    assert.equal(response.status, 200);
  });

  it('rejects requests from other sites', async () => {
    await client.get('/auth/session/');
    const response = await fetch(`${client.base}/api/auth/login/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Origin: 'https://evil.example',
        'X-CSRFToken': client.cookies.csrftoken, Cookie: `csrftoken=${client.cookies.csrftoken}`,
      },
      body: JSON.stringify({ username: 'tina', password: PASSWORD }),
    });
    assert.equal(response.status, 403);
  });

  it('does not store the session token itself', async () => {
    await client.post('/auth/login/', { username: 'tina', password: PASSWORD });
    const stored = await db.get('SELECT id FROM sessions');
    assert.notEqual(stored.id, client.cookies.sessionid);
  });
});

describe('role dashboards', () => {
  it('gives signed-out users a 401', async () => {
    for (const url of ['/dashboard/', '/profile/', '/badges/', '/browse/', '/owner/properties/', '/admin/users/']) {
      assert.equal((await client.get(url)).status, 401, url);
    }
  });

  it('gives each role its own dashboard', async () => {
    const expected = { admin: 'total_users', owner: 'property_count', tenant: 'app_total', manager: 'property_count' };
    for (const [role, key] of Object.entries(expected)) {
      await client.login(await makeUser(db, `user_${role}`, role));
      const { json } = await client.get('/dashboard/');
      assert.equal(json.role, role);
      assert.ok(key in json, key);
      client.logout();
    }
  });

  it('gives the wrong role a 403', async () => {
    await client.login(await makeUser(db, 'tina', 'tenant'));
    assert.equal((await client.get('/owner/properties/')).status, 403);
  });

  it('answers unknown API URLs with a JSON 404', async () => {
    const response = await client.get('/no-such-endpoint/');
    assert.equal(response.status, 404);
    assert.ok(response.json.message);
  });
});

describe('profile', () => {
  let user;
  let other;
  beforeEach(async () => {
    user = await makeUser(db, 'alice', 'tenant', { phone: '111' });
    other = await makeUser(db, 'bob', 'owner', { phone: '222' });
    await client.login(user);
  });

  it('shows only your own profile', async () => {
    const data = (await client.get('/profile/')).json.user;
    assert.equal(data.email, 'alice@example.com');
    assert.ok(!('gcash_number' in data)); // tenants have no GCash details
  });

  it('updates the profile', async () => {
    const response = await client.postForm('/profile/', {
      first_name: 'Alicia', last_name: 'Reyes', email: 'alicia@example.com', phone: '0999',
    });
    assert.equal(response.json.message, 'Profile updated successfully.');
    const fresh = await reload(db, 'users', user);
    assert.deepEqual([fresh.first_name, fresh.email, fresh.phone], ['Alicia', 'alicia@example.com', '0999']);
    assert.equal((await reload(db, 'users', other)).email, 'bob@example.com');
  });

  it("can't take another user's email", async () => {
    const response = await client.postForm('/profile/', { first_name: 'A', last_name: 'B', email: 'bob@example.com', phone: '1' });
    assert.equal(response.status, 400);
    assert.match(response.json.errors.email[0], /already used by another account/);
  });

  it("can't change the role", async () => {
    await client.postForm('/profile/', { first_name: 'A', last_name: 'B', email: 'alice@example.com', phone: '1', role: 'admin' });
    assert.equal((await reload(db, 'users', user)).role, 'tenant');
  });

  it('uploads and clears a photo, and refuses files that are not images', async () => {
    const png = new Blob([Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex')], { type: 'image/png' });
    const base = { first_name: 'A', last_name: 'B', email: 'alice@example.com' };
    let response = await client.postForm('/profile/', { ...base, profile_photo: new File([png], 'me.png') });
    assert.equal(response.status, 200);
    assert.match(response.json.user.photo, /^\/media\/profile_photos\/me_[0-9a-f]+\.png$/);

    const photo = await fetch(`${client.base}${response.json.user.photo}`);
    assert.equal(photo.status, 200);

    response = await client.postForm('/profile/', { ...base, profile_photo: new File(['<script>alert(1)</script>'], 'x.html') });
    assert.equal(response.status, 400);
    assert.match(response.json.errors.profile_photo[0], /Upload a valid image/);

    response = await client.postForm('/profile/', { ...base, 'profile_photo-clear': 'on' });
    assert.equal(response.json.user.photo, null);
  });
});
