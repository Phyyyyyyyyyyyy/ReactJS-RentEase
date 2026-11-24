/**
 * The 14 common "vibe-coded app" attacks, each tried against RentEase.
 * Every test here is an attack that must fail.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { monthStart } from '../src/billing.js';
import { addDays, today } from '../src/lib/format.js';
import { schemaSql } from '../src/schema.js';
import { makeApplication, makeProperty, makeUnit, makeUser, PASSWORD, reload, setup } from './helpers.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const REF = '1234567890123';
const ROOT = path.resolve(import.meta.dirname, '..', '..');

let env;
let db;
let client;
let admin;
let owner;
let otherOwner;
let tenant;
let otherTenant;
let staff;
let prop;
let vacant;
let occupied;
let tenancy;

async function world(options) {
  env = await setup(options);
  ({ db, client } = env);
  admin = await makeUser(db, 'root', 'admin');
  owner = await makeUser(db, 'owner', 'owner', { gcash_number: '09171234567', gcash_name: 'Ana Santos' });
  otherOwner = await makeUser(db, 'owner2', 'owner');
  tenant = await makeUser(db, 'tenant', 'tenant');
  otherTenant = await makeUser(db, 'tenant2', 'tenant');
  staff = await makeUser(db, 'staffer', 'staff');
  prop = await makeProperty(db, owner, { name: 'Lahug Apartments', address: 'Salinas Dr' });
  vacant = await makeUnit(db, prop, { name: '101', rent: 8500 });
  occupied = await makeUnit(db, prop, { name: '102', rent: 8000, status: 'occupied' });
  const approvedAt = `${monthStart(addDays(monthStart(today()), -1))}T02:00:00.000Z`;
  tenancy = await makeApplication(db, tenant, occupied, { status: 'approved', approved_at: approvedAt });
}

afterEach(() => env.close());

const count = async (sql, params = []) => (await db.get(sql, params)).n;
const gcashPayment = (status = 'pending', reference = REF) => db.insert(
  `INSERT INTO payments (tenancy_id, amount, method, reference_number, paid_on, status, recorded_by_id, created_at)
   VALUES (?, 800000, 'gcash', ?, ?, ?, ?, ?)`,
  [tenancy.id, reference, today(), status, tenant.id, new Date().toISOString()],
);

describe('the 14 attacks', () => {
  beforeEach(() => world());

  it('1. Type /admin: only admins can use the admin API', async () => {
    for (const user of [tenant, owner, staff]) {
      await client.login(user);
      assert.equal((await client.get('/admin/users/')).status, 403);
      assert.equal((await client.get(`/admin/users/${admin.id}/`)).status, 403);
      assert.equal((await client.post('/admin/users/', { username: 'x', role: 'admin' })).status, 403);
      assert.equal((await client.put(`/admin/users/${user.id}/`, { role: 'admin', is_active: true })).status, 403);
      assert.equal((await reload(db, 'users', user)).role, user.role);
    }
    client.logout();
    assert.equal((await client.get('/admin/users/')).status, 401);
  });

  it("2. Change the ID in the URL: other people's records are a 404", async () => {
    const theirApp = await makeApplication(db, otherTenant, vacant, { message: 'PRIVATE' });
    const theirPayment = await gcashPayment();
    await client.login(otherTenant);
    // Another tenant's tenancy and payment.
    assert.equal((await client.get(`/payments/${tenancy.id}/gcash/`)).status, 404);
    assert.equal((await client.post(`/payments/submissions/${theirPayment}/cancel/`)).status, 404);

    await client.login(tenant);
    assert.equal((await client.get(`/applications/${theirApp.id}/`)).status, 404);
    assert.equal((await client.put(`/applications/${theirApp.id}/`, { message: 'hacked' })).status, 404);
    assert.equal((await client.post(`/applications/${theirApp.id}/withdraw/`)).status, 404);

    // Another owner's property, unit, applications, tenancy, and payments.
    await client.login(otherOwner);
    assert.equal((await client.get(`/owner/properties/${prop.id}/`)).status, 404);
    assert.equal((await client.delete(`/owner/properties/${prop.id}/`)).status, 404);
    assert.equal((await client.put(`/owner/units/${vacant.id}/`, { name: 'x' })).status, 404);
    assert.equal((await client.post(`/owner/applications/${theirApp.id}/approve/`)).status, 404);
    assert.equal((await client.get(`/owner/payments/tenancy/${tenancy.id}/`)).status, 404);
    assert.equal((await client.post(`/owner/payments/${theirPayment}/confirm/`)).status, 404);
    const listing = await client.get('/owner/applications/', { status: 'all' });
    assert.ok(!listing.text.includes('PRIVATE'));

    assert.equal((await reload(db, 'applications', theirApp)).status, 'pending');
    assert.ok(await reload(db, 'properties', prop));
    assert.equal((await db.get('SELECT status FROM payments WHERE id = ?', [theirPayment])).status, 'pending');
  });

  it('3. API key in the browser: no secrets or password hashes are ever sent', async () => {
    await client.login(admin);
    for (const url of ['/auth/session/', '/profile/', '/admin/users/', '/dashboard/', `/admin/users/${tenant.id}/`]) {
      const { text } = await client.get(url);
      assert.ok(!/pbkdf2|"password"|session/i.test(text.replace(/"last_login"/g, '')), url);
    }
    // The React source has no keys, tokens, or database URLs in it.
    const files = execFileSync('git', ['ls-files', 'frontend/src', 'frontend/index.html'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter(Boolean);
    for (const file of files) {
      const text = readFileSync(path.join(ROOT, file), 'utf8');
      assert.ok(!/(api[_-]?key|service_role|sk_live|postgres(ql)?:\/\/|DATABASE_URL)/i.test(text), file);
    }
  });

  it('4. Edit the price: rent comes from the server; a claimed amount counts only when the owner confirms', async () => {
    await client.login(tenant);
    // A tenant can't change the rent.
    assert.equal((await client.put(`/owner/units/${occupied.id}/`, { monthly_rent: 1, name: '102' })).status, 403);
    // Claiming a huge GCash payment does nothing until the owner checks it.
    const before = (await client.get('/payments/')).json.ledgers[0].balance;
    assert.equal((await client.postForm(`/payments/${tenancy.id}/gcash/`,
      { amount: '99999999', reference_number: REF, paid_on: today() })).status, 201);
    const after = (await client.get('/payments/')).json.ledgers[0];
    assert.equal(after.balance, before);
    assert.equal(after.credit, '0.00');
    // Extra fields can't set the rent of a new charge or the payment status.
    assert.equal((await db.get('SELECT status FROM payments')).status, 'pending');
    assert.ok((await db.all('SELECT amount FROM rent_charges')).every((c) => c.amount === 800000));
  });

  it('5. Order -1 items: negative and zero amounts are refused everywhere', async () => {
    await client.login(owner);
    const unit = (over) => client.post(`/owner/properties/${prop.id}/units/`,
      { name: 'N', bedrooms: 1, bathrooms: 1, floor_area: 10, monthly_rent: 5000, status: 'vacant', ...over });
    assert.ok((await unit({ monthly_rent: -5000 })).json.errors.monthly_rent);
    assert.ok((await unit({ monthly_rent: 0 })).json.errors.monthly_rent);
    assert.ok((await unit({ bedrooms: -1 })).json.errors.bedrooms);
    assert.ok((await unit({ floor_area: '-1' })).json.errors.floor_area);
    assert.ok((await unit({ monthly_rent: '1e9' })).json.errors.monthly_rent);
    const record = (amount) => client.post(`/owner/payments/tenancy/${tenancy.id}/`,
      { amount, method: 'cash', paid_on: today() });
    for (const amount of ['-8000', '0', '-0.01', '0.5']) assert.ok((await record(amount)).json.errors.amount, amount);

    await client.login(tenant);
    const gcash = (amount, reference_number) => client.postForm(`/payments/${tenancy.id}/gcash/`,
      { amount, reference_number, paid_on: today() });
    assert.ok((await gcash('-100', REF)).json.errors.amount);
    assert.ok((await gcash('0', '1111111111111')).json.errors.amount);
    assert.equal((await client.get('/browse/', { max_rent: '-1' })).json.invalid_filter, true);

    assert.equal(await count('SELECT COUNT(*) AS n FROM payments'), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM units WHERE name = 'N'"), 0);
    // The database itself refuses non-positive payments too.
    await assert.rejects(db.run(`INSERT INTO payments (tenancy_id, amount, method, paid_on, created_at)
      VALUES (?, -1, 'cash', ?, ?)`, [tenancy.id, today(), today()]));
  });

  it("6. Fake a payment: tenants can't confirm or record payments themselves", async () => {
    const id = await gcashPayment();
    await client.login(tenant);
    assert.equal((await client.post(`/owner/payments/${id}/confirm/`)).status, 403);
    assert.equal((await client.post(`/owner/payments/tenancy/${tenancy.id}/`,
      { amount: '8000', method: 'cash', paid_on: today() })).status, 403);
    // Sneaking a status into a GCash submission is ignored: it stays pending.
    await client.postForm(`/payments/${tenancy.id}/gcash/`,
      { amount: '8000', reference_number: '5555555555555', paid_on: today(), status: 'confirmed', method: 'cash' });
    assert.deepEqual((await db.all('SELECT status, method FROM payments ORDER BY id')).map((p) => [p.status, p.method]),
      [['pending', 'gcash'], ['pending', 'gcash']]);
    // A reference number already used for another payment is refused.
    const reused = await client.postForm(`/payments/${tenancy.id}/gcash/`, { amount: '8000', reference_number: REF, paid_on: today() });
    assert.match(reused.json.errors.reference_number[0], /already been submitted/);
  });

  it('7. Redeem it 100 times: requests sent all at once still only work once', async () => {
    await client.login(tenant);
    const submissions = await Promise.all(Array.from({ length: 20 }, () => client.postForm(
      `/payments/${tenancy.id}/gcash/`, { amount: '8000', reference_number: '7777777777777', paid_on: today() })));
    assert.equal(submissions.filter((r) => r.status === 201).length, 1);
    assert.equal(await count('SELECT COUNT(*) AS n FROM payments'), 1);

    const applies = await Promise.all(Array.from({ length: 10 }, () =>
      client.post(`/browse/${prop.id}/apply/`, { unit: vacant.id })));
    assert.equal(applies.filter((r) => r.status === 201).length, 1);

    await client.login(owner);
    const payment = (await db.get('SELECT id FROM payments')).id;
    const confirms = await Promise.all(Array.from({ length: 10 }, () => client.post(`/owner/payments/${payment}/confirm/`)));
    assert.equal(confirms.filter((r) => r.status === 200).length, 1);

    // Ten tenants applied for one unit; approving them all at once approves exactly one.
    const apps = [];
    for (let i = 0; i < 10; i += 1) apps.push(await makeApplication(db, await makeUser(db, `t${i}`, 'tenant'), vacant));
    const approvals = await Promise.all(apps.map((a) => client.post(`/owner/applications/${a.id}/approve/`)));
    assert.equal(approvals.filter((r) => r.status === 200).length, 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM applications WHERE unit_id = ? AND status = 'approved'", [vacant.id]), 1);
  });

  it("8. Admin at signup: you can't make yourself an admin or staff", async () => {
    const base = { first_name: 'Eve', last_name: 'Hacker', email: 'eve@example.com', phone: '0917',
      password1: PASSWORD, password2: PASSWORD };
    for (const role of ['admin', 'staff', 'ADMIN', 'superuser']) {
      const response = await client.post('/auth/register/', { ...base, username: `eve_${role}`, role });
      assert.equal(response.status, 400, role);
    }
    await client.post('/auth/register/', { ...base, username: 'eve', role: 'tenant', is_superuser: true, is_active: 0 });
    const eve = await db.get("SELECT * FROM users WHERE username = 'eve'");
    assert.deepEqual([eve.role, eve.is_active], ['tenant', 1]);
    // And not later, through the profile form.
    await client.login(eve);
    await client.postForm('/profile/', { first_name: 'Eve', last_name: 'H', email: 'eve@example.com', role: 'admin' });
    assert.equal((await reload(db, 'users', eve)).role, 'tenant');
  });

  it('10. Prompt-inject your AI: RentEase has no AI features to inject into', () => {
    const files = execFileSync('git', ['ls-files', '--others', '--cached', '--exclude-standard', 'backend/src', 'frontend/src'],
      { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    for (const file of files) {
      const text = readFileSync(path.join(ROOT, file), 'utf8');
      assert.ok(!/openai|anthropic|completions|generativeai/i.test(text), file);
    }
  });

  it('11. Script in your username: refused in usernames, harmless anywhere else', async () => {
    const response = await client.post('/auth/register/', {
      first_name: '<img src=x onerror=alert(1)>', last_name: 'X', username: '<script>alert(1)</script>',
      email: 'x@example.com', phone: '1', role: 'tenant', password1: PASSWORD, password2: PASSWORD,
    });
    assert.match(response.json.errors.username[0], /Enter a valid username/);
    // Names may contain anything, but the API only ever returns JSON (shown as text by React).
    await client.login(tenant);
    const saved = await client.postForm('/profile/', { first_name: '<script>alert(1)</script>', last_name: 'X', email: 'tenant@example.com' });
    assert.equal(saved.status, 200);
    const raw = await fetch(`${client.base}/api/profile/`, { headers: { Cookie: `sessionid=${client.cookies.sessionid}` } });
    assert.match(raw.headers.get('content-type'), /^application\/json/);
    assert.equal(raw.headers.get('x-content-type-options'), 'nosniff');
  });

  it('12. Upload a non-photo: only real images are kept, and they are served as images', async () => {
    await client.login(tenant);
    const base = { first_name: 'T', last_name: 'X', email: 'tenant@example.com' };
    const upload = (file) => client.postForm('/profile/', { ...base, profile_photo: file });
    for (const file of [
      new File(['<script>alert(1)</script>'], 'evil.html'),
      new File(['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'], 'evil.svg'),
      new File(['MZ fake program'], 'virus.exe'),
      new File(['<?php system($_GET["c"]); ?>'], 'shell.png'),
    ]) {
      const response = await upload(file);
      assert.equal(response.status, 400, file.name);
      assert.match(response.json.errors.profile_photo[0], /Upload a valid image/);
    }
    // A real image with a dangerous name is saved under a safe name with the right extension.
    const ok = await upload(new File([Buffer.concat([PNG, Buffer.from('<script>alert(1)</script>')])], '../../evil.html'));
    assert.equal(ok.status, 200);
    assert.match(ok.json.user.photo, /^\/media\/profile_photos\/[\w-]+\.png$/);
    const served = await fetch(`${client.base}${ok.json.user.photo}`);
    assert.equal(served.headers.get('content-type'), 'image/png');
    assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
    // Payment receipts too.
    const receipt = await client.postForm(`/payments/${tenancy.id}/gcash/`,
      { amount: '8000', reference_number: REF, paid_on: today(), proof: new File(['%PDF-1.4'], 'r.pdf') });
    assert.match(receipt.json.errors.proof[0], /Upload a valid image/);
  });

  it('13. .env in Git: secrets files are ignored and were never committed', () => {
    const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
    assert.equal(git('check-ignore', 'backend/.env').trim(), 'backend/.env');
    assert.equal(git('check-ignore', 'backend/rentease.sqlite3').trim(), 'backend/rentease.sqlite3');
    assert.equal(git('check-ignore', 'backend/media/x.png').trim(), 'backend/media/x.png');
    const everCommitted = git('log', '--all', '--name-only', '--pretty=format:').split('\n')
      .filter((f) => /(^|\/)\.env(\..+)?$/.test(f) && !f.endsWith('.env.example'));
    assert.deepEqual(everCommitted, []);
  });

  it('14. Query your database: SQL injection does nothing, and the database file is never served', async () => {
    await client.login(tenant);
    for (const q of ["' OR '1'='1", "x'); DROP TABLE users; --", '%', '_', '\\']) {
      const response = await client.get('/browse/', { q });
      assert.equal(response.status, 200, q);
      assert.deepEqual(response.json.properties, [], q);
    }
    const login = await env.newClient().post('/auth/login/', { username: "root' --", password: 'x' });
    assert.equal(login.status, 400);
    assert.equal(await count('SELECT COUNT(*) AS n FROM users'), 6);
    for (const url of ['/rentease.sqlite3', '/media/../rentease.sqlite3', '/media/..%2f..%2frentease.sqlite3', '/.env', '/media/../.env']) {
      const response = await fetch(`${client.base}${url}`);
      const text = await response.text();
      assert.ok(!text.startsWith('SQLite format') && !/DATABASE_URL|SECRET/.test(text), url);
    }
    // On Supabase, the public Data API is locked out of every table.
    assert.match(schemaSql('postgres'), /ENABLE ROW LEVEL SECURITY/);
    assert.match(schemaSql('postgres'), /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated/);
  });
});

describe('9. Guess the login code: password guessing is cut off', () => {
  const limits = {
    loginPerAccount: { limit: 3, windowMs: 60_000 },
    loginPerAddress: { limit: 6, windowMs: 60_000 },
    signupPerAddress: { limit: 2, windowMs: 60_000 },
  };
  beforeEach(() => world({ limits }));

  it('locks an account after repeated wrong passwords, even for the right one', async () => {
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await client.post('/auth/login/', { username: 'tenant', password: `guess${i}` })).status, 400);
    }
    // Switching to the email address doesn't get around it.
    const blocked = await client.post('/auth/login/', { username: 'tenant@example.com', password: PASSWORD });
    assert.equal(blocked.status, 429);
    assert.match(blocked.json.message, /Too many failed sign-in attempts/);
    // Other accounts still work.
    assert.equal((await client.post('/auth/login/', { username: 'owner', password: PASSWORD })).status, 200);
  });

  it('blocks one address trying many accounts', async () => {
    const guesser = env.newClient();
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) await guesser.post('/auth/login/', { username: name, password: 'x' });
    assert.equal((await guesser.post('/auth/login/', { username: 'owner', password: PASSWORD })).status, 429);
  });

  it('limits mass sign-ups', async () => {
    const signup = (n) => client.post('/auth/register/', {
      first_name: 'A', last_name: 'B', username: `bot${n}`, email: `bot${n}@example.com`, phone: '1',
      role: 'tenant', password1: PASSWORD, password2: PASSWORD,
    });
    assert.equal((await signup(1)).status, 201);
    assert.equal((await signup(2)).status, 201);
    assert.equal((await signup(3)).status, 429);
  });

  it('the session cookie is HttpOnly and the session token is unguessable', async () => {
    const response = await fetch(`${client.base}/api/auth/session/`);
    const csrf = response.headers.getSetCookie()[0];
    await client.post('/auth/login/', { username: 'tenant', password: PASSWORD });
    assert.ok(client.cookies.sessionid.length >= 43); // 256 random bits
    const login = await fetch(`${client.base}/api/auth/login/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': client.cookies.csrftoken, Cookie: `csrftoken=${client.cookies.csrftoken}` },
      body: JSON.stringify({ username: 'owner', password: PASSWORD }),
    });
    const sessionCookie = login.headers.getSetCookie().find((c) => /^sessionid=[^;]+/.test(c));
    assert.match(sessionCookie, /HttpOnly/i);
    assert.match(sessionCookie, /SameSite=Lax/i);
    assert.doesNotMatch(csrf, /HttpOnly/i); // the CSRF cookie must be readable by the React app
  });
});

describe('the built React page', () => {
  let dist;
  beforeEach(async () => {
    dist = mkdtempSync(path.join(tmpdir(), 'rentease-dist-'));
    writeFileSync(path.join(dist, 'index.html'), '<html><head><script>window.theme = 1;</script></head><body></body></html>');
    await world({ frontendDist: dist });
  });
  afterEach(() => rmSync(dist, { recursive: true, force: true }));

  it('only runs scripts from the site itself (Content-Security-Policy)', async () => {
    const response = await fetch(`${client.base}/dashboard/tenant`);
    const csp = response.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
    assert.match(csp, /frame-ancestors 'none'/);
  });
});
