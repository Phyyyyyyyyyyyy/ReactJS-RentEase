/**
 * Test helpers: a fresh in-memory database and server per test, and a client
 * that keeps cookies and sends the CSRF token like the React app does.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { createSessionToken } from '../src/lib/auth.js';
import { nowIso } from '../src/lib/format.js';
import { createUser } from '../src/users.js';

process.env.PASSWORD_ITERATIONS = '1000'; // fast hashing in tests

export const PASSWORD = 'Str0ng-Pass!42';

export class Client {
  constructor(base, db) {
    this.base = base;
    this.db = db;
    this.cookies = {};
  }

  remember(response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = decodeURIComponent(pair.slice(i + 1));
      const expired = attributes.some((a) => /expires=thu, 01 jan 1970/i.test(a.trim()) || /max-age=0/i.test(a.trim()));
      if (expired || value === '') delete this.cookies[name];
      else this.cookies[name] = value;
    }
  }

  async request(method, url, { json, form, query, csrf = true } = {}) {
    const headers = { Accept: 'application/json' };
    let body;
    if (method !== 'GET' && csrf) {
      if (!this.cookies.csrftoken) await this.request('GET', '/auth/session/');
      headers['X-CSRFToken'] = this.cookies.csrftoken;
    }
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form !== undefined) {
      body = new FormData();
      for (const [key, value] of Object.entries(form)) body.append(key, value);
    }
    const cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    const qs = query ? `?${new URLSearchParams(query)}` : '';
    const response = await fetch(`${this.base}/api${url}${qs}`, { method, headers, body });
    this.remember(response);
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, json: data, text };
  }

  get(url, query) { return this.request('GET', url, { query }); }
  post(url, json = {}) { return this.request('POST', url, { json }); }
  put(url, json) { return this.request('PUT', url, { json }); }
  delete(url) { return this.request('DELETE', url, {}); }
  /** multipart/form-data, as the React app sends for file uploads. */
  postForm(url, form) { return this.request('POST', url, { form }); }

  /** Sign in as `user` without a password (like Django's force_login). */
  async login(user) {
    this.cookies.sessionid = await createSessionToken(this.db, user.id);
  }

  logout() {
    delete this.cookies.sessionid;
  }
}

/** Start a server on a fresh database. Call `await env.close()` when done. */
export async function setup(options = {}) {
  const mediaDir = mkdtempSync(path.join(tmpdir(), 'rentease-media-'));
  const db = await openDatabase({ url: '', sqlitePath: ':memory:' });
  const server = createApp(db, { mediaDir, ...options }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db,
    mediaDir,
    client: new Client(base, db),
    newClient: () => new Client(base, db),
    async close() {
      server.closeAllConnections();
      server.close();
      await db.close();
      rmSync(mediaDir, { recursive: true, force: true });
    },
  };
}

export function makeUser(db, username, role, extra = {}) {
  return createUser(db, {
    username, email: `${username}@example.com`, password: PASSWORD,
    first_name: username[0].toUpperCase() + username.slice(1), last_name: 'Test', role, ...extra,
  });
}

export async function makeProperty(db, owner, { name, property_type = 'apartment', address = 'Somewhere', city = 'Cebu City', amenities = '' }) {
  const id = await db.insert(
    `INSERT INTO properties (owner_id, name, property_type, address, city, amenities, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [owner.id, name, property_type, address, city, amenities, nowIso()],
  );
  return db.get('SELECT * FROM properties WHERE id = ?', [id]);
}

/** `rent` in pesos. */
export async function makeUnit(db, property, { name, rent, status = 'vacant' }) {
  const id = await db.insert(
    'INSERT INTO units (property_id, name, monthly_rent, status) VALUES (?, ?, ?, ?)',
    [property.id, name, rent * 100, status],
  );
  return db.get('SELECT * FROM units WHERE id = ?', [id]);
}

export async function makeApplication(db, tenant, unit, { status = 'pending', message = '', approved_at = null, preferred_move_in = null } = {}) {
  const now = nowIso();
  const id = await db.insert(
    `INSERT INTO applications (tenant_id, unit_id, message, preferred_move_in, status, created_at, updated_at, approved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [tenant.id, unit.id, message, preferred_move_in, status, now, now, approved_at],
  );
  return db.get('SELECT * FROM applications WHERE id = ?', [id]);
}

export const reload = (db, table, row) => db.get(`SELECT * FROM ${table} WHERE id = ?`, [row.id]);

/** An active referral code for `role` (created directly in the database). */
export async function makeReferral(db, role = 'tenant', code = `TEST-${role.toUpperCase()}`) {
  const id = await db.insert(
    'INSERT INTO referral_codes (code, role, label, is_active, created_at) VALUES (?, ?, ?, 1, ?)',
    [code, role, '', nowIso()],
  );
  return db.get('SELECT * FROM referral_codes WHERE id = ?', [id]);
}
