/**
 * Sign-in sessions and CSRF protection.
 *
 * Sessions: signing in creates a random token, sent to the browser in the
 * HttpOnly `sessionid` cookie. The database stores only its SHA-256 hash, so a
 * leaked database can't be used to sign in. Sessions last two weeks.
 *
 * CSRF: GET /api/auth/session/ sets a `csrftoken` cookie. The React app sends
 * it back in the X-CSRFToken header on every request that changes data
 * (including sign-in and registration); requests without it get a 403. Another
 * site can't read the cookie, so it can't forge the header.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from './http.js';
import { nowIso } from './format.js';

const SESSION_COOKIE = 'sessionid';
const CSRF_COOKIE = 'csrftoken';
const SESSION_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const CSRF_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!(name in cookies)) {
      try {
        cookies[name] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        cookies[name] = part.slice(i + 1).trim();
      }
    }
  }
  return cookies;
}

function cookieOptions(maxAge, httpOnly) {
  return { maxAge, httpOnly, sameSite: 'lax', secure: config.secureCookies, path: '/' };
}

/** Middleware: sets req.cookies and req.user (the signed-in, active user, or null). */
export function loadUser(db) {
  return async (req, res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    req.user = null;
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      req.user = await db.get(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.expires_at > ? AND u.is_active = 1`,
        [hashToken(token), nowIso()],
      ) || null;
    }
    next();
  };
}

/** Start a session for `user` (replacing any current one) and set the cookies. */
export async function signIn(db, req, res, user) {
  await signOut(db, req, res);
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  await db.run('DELETE FROM sessions WHERE expires_at <= ?', [new Date(now).toISOString()]);
  await db.run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)',
    [hashToken(token), user.id, new Date(now + SESSION_AGE_MS).toISOString()]);
  await db.run('UPDATE users SET last_login = ? WHERE id = ?', [new Date(now).toISOString(), user.id]);
  res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_AGE_MS, true));
  // A new CSRF token after signing in, like Django does.
  setCsrfCookie(res);
  return token;
}

export async function signOut(db, req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await db.run('DELETE FROM sessions WHERE id = ?', [hashToken(token)]);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  req.user = null;
}

/** Used by the tests (like Django's force_login): a session token for `userId`. */
export async function createSessionToken(db, userId) {
  const token = randomBytes(32).toString('base64url');
  await db.run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)',
    [hashToken(token), userId, new Date(Date.now() + SESSION_AGE_MS).toISOString()]);
  return token;
}

function setCsrfCookie(res) {
  const token = randomBytes(24).toString('base64url');
  res.cookie(CSRF_COOKIE, token, cookieOptions(CSRF_AGE_MS, false));
  return token;
}

/** Make sure the browser has a CSRF cookie (GET /api/auth/session/ calls this). */
export function ensureCsrfCookie(req, res) {
  if (!/^[\w-]{32}$/.test(req.cookies[CSRF_COOKIE] || '')) setCsrfCookie(res);
}

function sameToken(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Middleware: reject data-changing requests without a matching CSRF token or from another site. */
export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    const own = `${req.protocol}://${req.headers.host}`;
    if (origin !== own && !config.trustedOrigins.includes(origin)) {
      throw new HttpError(403, { message: `CSRF Failed: Origin checking failed - ${origin} does not match any trusted origins.` });
    }
  }
  const cookie = req.cookies[CSRF_COOKIE];
  if (!cookie) throw new HttpError(403, { message: 'CSRF Failed: CSRF cookie not set.' });
  const header = req.headers['x-csrftoken'];
  if (!header || !sameToken(header, cookie)) {
    throw new HttpError(403, { message: 'CSRF Failed: CSRF token missing or incorrect.' });
  }
  return next();
}
