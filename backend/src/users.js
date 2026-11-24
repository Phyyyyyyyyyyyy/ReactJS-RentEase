/** Users: roles, creating accounts, and the JSON shapes the React app reads. */
import { fileUrl } from './lib/files.js';
import { iso, nowIso } from './lib/format.js';
import { hashPassword } from './lib/passwords.js';

export const ROLES = [
  ['admin', 'Admin'],
  ['owner', 'Property Owner'],
  ['tenant', 'Tenant'],
  ['staff', 'Staff'],
];
export const ROLE_LABEL = Object.fromEntries(ROLES);

// Roles a visitor may pick on the public registration form.
// Admin and Staff accounts are created by an administrator.
export const SELF_REGISTER_ROLES = ROLES.filter(([role]) => role === 'tenant' || role === 'owner');

// Philippine mobile number as GCash uses it: 09XXXXXXXXX (11 digits).
export const GCASH_NUMBER_RE = /^09\d{9}$/;

export const fullName = (u) => `${u.first_name || ''} ${u.last_name || ''}`.trim();
export const displayName = (u) => fullName(u) || u.username;

export function initials(u) {
  return displayName(u).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export const acceptsGcash = (u) => Boolean(u.gcash_number);

/** Name and avatar of another person (an owner or a tenant). */
export function userBrief(u, { contact = false } = {}) {
  const data = {
    id: u.id,
    username: u.username,
    full_name: displayName(u),
    initials: initials(u),
    photo: fileUrl(u.profile_photo),
  };
  if (contact) Object.assign(data, { email: u.email, phone: u.phone });
  return data;
}

/** The signed-in user's own account. */
export function userJson(u) {
  const data = {
    ...userBrief(u, { contact: true }),
    first_name: u.first_name,
    last_name: u.last_name,
    role: u.role,
    role_display: ROLE_LABEL[u.role],
    is_active: Boolean(u.is_active),
    is_superuser: u.role === 'admin',
    date_joined: iso(u.date_joined),
    last_login: iso(u.last_login),
  };
  if (u.role === 'owner') {
    Object.assign(data, {
      gcash_name: u.gcash_name,
      gcash_number: u.gcash_number,
      gcash_qr: fileUrl(u.gcash_qr),
      accepts_gcash: acceptsGcash(u),
    });
  }
  return data;
}

/** Create an account. The password is hashed; it is never stored as plain text. */
export async function createUser(db, { username, email, password, first_name = '', last_name = '', role = 'tenant',
  phone = '', gcash_name = '', gcash_number = '', is_active = true }) {
  const id = await db.insert(
    `INSERT INTO users (username, email, password, first_name, last_name, role, phone, gcash_name, gcash_number,
       is_active, date_joined)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [username, email.toLowerCase(), await hashPassword(password), first_name, last_name, role, phone, gcash_name,
      gcash_number, is_active ? 1 : 0, nowIso()],
  );
  return db.get('SELECT * FROM users WHERE id = ?', [id]);
}

export const findUser = (db, id) => db.get('SELECT * FROM users WHERE id = ?', [id]);

export async function usernameTaken(db, username, exceptId = 0) {
  return Boolean(await db.get('SELECT 1 AS x FROM users WHERE LOWER(username) = LOWER(?) AND id <> ?', [username, exceptId]));
}

export async function emailTaken(db, email, exceptId = 0) {
  return Boolean(await db.get('SELECT 1 AS x FROM users WHERE LOWER(email) = LOWER(?) AND id <> ?', [email, exceptId]));
}
