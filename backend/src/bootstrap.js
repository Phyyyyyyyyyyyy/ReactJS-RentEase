/**
 * Make sure an admin account exists, from environment variables:
 *
 *   ADMIN_USERNAME=reuben  ADMIN_EMAIL=you@example.com  ADMIN_PASSWORD=a-strong-password
 *
 * On every start: creates the account if it's missing; if it already exists,
 * sets its password to ADMIN_PASSWORD and makes sure it is an active Admin.
 * So these settings also recover the admin account if you're locked out.
 * Useful on hosts with no shell for `npm run create-admin` (like Render's free plan).
 */
import { checkPassword, hashPassword, passwordProblems } from './lib/passwords.js';
import { createUser } from './users.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@.]+$/;
const USERNAME_RE = /^[\p{L}\p{N}_.@+-]{1,150}$/u;

/** Returns a short description of what happened (for the server log). Never logs the password. */
export async function ensureAdmin(db, { username, email, password } = {}) {
  username = String(username || '').trim();
  email = String(email || '').trim().toLowerCase();
  password = String(password || '');
  if (!username && !password) return null; // not configured
  if (!USERNAME_RE.test(username)) return 'ADMIN_USERNAME is missing or has characters other than letters, numbers, and @/./+/-/_.';
  if (!password) return 'ADMIN_PASSWORD is missing.';
  const problems = passwordProblems(password, { username, email });
  if (problems.length) return `ADMIN_PASSWORD was not used: ${problems.join(' ')}`;

  const existing = await db.get('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username]);
  if (existing) {
    await db.run("UPDATE users SET role = 'admin', is_active = 1 WHERE id = ?", [existing.id]);
    if (await checkPassword(password, existing.password)) return `Admin account "${existing.username}" is ready.`;
    await db.run('UPDATE users SET password = ? WHERE id = ?', [await hashPassword(password), existing.id]);
    await db.run('DELETE FROM sessions WHERE user_id = ?', [existing.id]); // the old password's sessions end
    return `Admin account "${existing.username}" is ready (password set from ADMIN_PASSWORD).`;
  }
  if (!EMAIL_RE.test(email)) return 'ADMIN_EMAIL is missing or not a valid email address, so the admin account was not created.';
  if (await db.get('SELECT 1 AS x FROM users WHERE LOWER(email) = LOWER(?)', [email])) {
    return `ADMIN_EMAIL ${email} already belongs to another account, so the admin account was not created.`;
  }
  await createUser(db, { username, email, password, role: 'admin', first_name: 'Admin' });
  return `Admin account "${username}" created.`;
}
