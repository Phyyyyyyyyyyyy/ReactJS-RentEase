/** Accounts API: session, sign in/out, registration, profile, sidebar badges, dashboards. */
import { Router } from 'express';
import { ledgersFor, tenanciesFor } from '../billing.js';
import { ensureCsrfCookie, signIn, signOut } from '../lib/auth.js';
import { deleteFile, imageType, INVALID_IMAGE, saveImage } from '../lib/files.js';
import { Form } from '../lib/forms.js';
import { endpoint, fail, formErrors, HttpError, reply } from '../lib/http.js';
import { sendVerificationEmail, verifyEmailToken } from '../verification.js';
import { remindTenant } from '../notifications.js';
import { RUNS } from './properties.js';
import { iso, money, nowIso } from '../lib/format.js';
import { checkPassword, hashPassword, passwordProblems } from '../lib/passwords.js';
import { minutes, RateLimiter } from '../lib/rateLimit.js';
import { isUniqueViolation } from '../db.js';
import {
  emailTaken, findUser, GCASH_NUMBER_RE, ROLES, SELF_REGISTER_ROLES, userBrief, userJson,
  usernameTaken,
} from '../users.js';

// Letters, digits and @/./+/-/_ only.
const USERNAME_RE = /^[\p{L}\p{N}_.@+-]+$/u;

// Checking a password takes time; do it even for unknown accounts so the
// response time doesn't reveal which accounts exist.
let dummyHash;

/**
 * Validate the fields of a new account (registration, and admins creating users).
 * Returns the cleaned values; errors are recorded on `form`.
 */
export async function validateNewAccount(db, form, roles) {
  const values = {
    first_name: form.text('first_name', { max: 150 }),
    last_name: form.text('last_name', { max: 150 }),
    username: form.text('username', { max: 150 }),
    email: form.email('email'),
    phone: form.text('phone', { max: 20 }),
    role: form.choice('role', roles),
  };
  if (values.username && form.ok('username')) {
    if (!USERNAME_RE.test(values.username)) {
      form.error('username', 'Enter a valid username. This value may contain only letters, numbers, and @/./+/-/_ characters.');
    } else if (await usernameTaken(db, values.username)) {
      form.error('username', 'This username is already taken.');
    }
  }
  if (values.email && form.ok('email') && await emailTaken(db, values.email)) {
    form.error('email', 'An account with this email already exists.');
  }
  values.password = validateNewPassword(form, values);
  return values;
}

/** password1 + password2: must match and pass the password rules. Errors go on password2. */
export function validateNewPassword(form, user, { required = true } = {}) {
  const password1 = form.text('password1', { required, strip: false });
  const password2 = form.text('password2', { required: required || Boolean(password1), strip: false });
  if (!password1 || !password2) return '';
  if (password1 !== password2) {
    form.error('password2', 'The two password fields didn’t match.');
    return '';
  }
  for (const problem of passwordProblems(password2, user)) form.error('password2', problem);
  return password2;
}

export const DEFAULT_LIMITS = {
  loginPerAccount: { limit: 10, windowMs: 15 * 60_000 },
  loginPerAddress: { limit: 50, windowMs: 15 * 60_000 },
  signupPerAddress: { limit: 10, windowMs: 60 * 60_000 },
  resendPerAccount: { limit: 3, windowMs: 15 * 60_000 },
  resendPerAddress: { limit: 10, windowMs: 60 * 60_000 },
};

export default function accountsRoutes(db, { mediaDir, limits = DEFAULT_LIMITS, mailer, appUrl }) {
  const router = Router();

  /** Email a verification link; returns false (and logs why) if it couldn't be sent. */
  async function emailLink(user) {
    try {
      await sendVerificationEmail(db, mailer, user, appUrl);
      return true;
    } catch (error) {
      console.error(`Could not send the verification email to user ${user.id}: ${error.message}`);
      return false;
    }
  }

  endpoint(router, '/auth/session/', {
    public: true,
    // Who is signed in (or null). Also sets the CSRF cookie the React app needs.
    GET: (req, res) => {
      ensureCsrfCookie(req, res);
      return { user: req.user ? userJson(req.user) : null };
    },
  });

  // Stop password guessing: after too many wrong passwords for one account, or
  // from one network address, sign-in is refused for a while (HTTP 429).
  const failedLoginsPerAccount = new RateLimiter(limits.loginPerAccount);
  const failedLoginsPerAddress = new RateLimiter(limits.loginPerAddress);
  // Stop mass sign-ups from one address.
  const signupsPerAddress = new RateLimiter(limits.signupPerAddress);

  endpoint(router, '/auth/login/', {
    public: true,
    POST: async (req, res) => {
      const form = new Form(req.body);
      const username = form.text('username', { max: 254 });
      const password = form.text('password', { strip: false });
      form.check();
      const lookup = username.includes('@') ? 'email' : 'username';
      const user = await db.get(`SELECT * FROM users WHERE LOWER(${lookup}) = LOWER(?)`, [username]);
      // Count by account id, so switching between username and email doesn't reset the count.
      const accountKey = user ? `user:${user.id}` : `name:${username.toLowerCase()}`;
      const wait = Math.max(failedLoginsPerAccount.retryAfter(accountKey), failedLoginsPerAddress.retryAfter(req.ip));
      if (wait) {
        res.set('Retry-After', String(wait));
        throw fail(`Too many failed sign-in attempts. Please wait ${minutes(wait)} and try again.`, 429);
      }
      let ok = false;
      if (user) {
        ok = await checkPassword(password, user.password);
      } else {
        dummyHash ??= await hashPassword('timing-only');
        await checkPassword(password, dummyHash);
      }
      if (!ok || !user.is_active) {
        failedLoginsPerAccount.hit(accountKey);
        failedLoginsPerAddress.hit(req.ip);
        const message = 'Invalid username/email or password. Please try again.';
        throw formErrors({ non_field_errors: [message] }, message);
      }
      failedLoginsPerAccount.reset(accountKey);
      // Only said after the right password, so it doesn't reveal which emails have accounts.
      if (!user.email_verified_at) {
        throw new HttpError(403, {
          code: 'email_unverified',
          message: `Please verify your email address first. Open the link we sent to ${user.email}, then sign in again.`,
        });
      }
      await signIn(db, req, res, user);
      const fresh = await findUser(db, user.id);
      return { user: userJson(fresh), message: `Welcome back, ${user.first_name || user.username}!` };
    },
  });

  endpoint(router, '/auth/logout/', {
    public: true,
    POST: async (req, res) => {
      await signOut(db, req, res);
      return { message: 'You have been signed out.' };
    },
  });

  endpoint(router, '/auth/register/', {
    public: true,
    POST: async (req, res) => {
      if (req.user) throw fail('You are already signed in.');
      const wait = signupsPerAddress.retryAfter(req.ip);
      if (wait) {
        res.set('Retry-After', String(wait));
        throw fail(`Too many new accounts from this network. Please wait ${minutes(wait)} and try again.`, 429);
      }
      const form = new Form(req.body);
      const values = await validateNewAccount(db, form, SELF_REGISTER_ROLES);
      form.check();
      let id;
      try {
        id = await db.insert(
          `INSERT INTO users (username, email, password, first_name, last_name, role, phone, date_joined)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [values.username, values.email, await hashPassword(values.password), values.first_name, values.last_name,
            values.role, values.phone, nowIso()],
        );
      } catch (error) {
        // The same username or email registered at the same moment by another request.
        if (isUniqueViolation(error)) throw formErrors({ username: ['This username or email is already taken.'] });
        throw error;
      }
      signupsPerAddress.hit(req.ip);
      const sent = await emailLink(await findUser(db, id));
      return reply(201, {
        message: sent
          ? `Account created. We sent a verification link to ${values.email}. Open it to activate your account, then sign in.`
          : 'Account created, but we couldn’t send the verification email. Use “Resend verification email” on the sign-in page.',
      });
    },
  });

  endpoint(router, '/auth/verify-email/', {
    public: true,
    POST: async (req) => {
      const user = await verifyEmailToken(db, req.body.token);
      if (!user) {
        throw fail('This verification link is invalid, was already used, or has expired. '
          + 'Sign in and use “Resend verification email” to get a new one.');
      }
      return { message: 'Email verified. You can now sign in.' };
    },
  });

  // Limit resends so this can't be used to flood someone's inbox.
  const resendsPerAccount = new RateLimiter(limits.resendPerAccount);
  const resendsPerAddress = new RateLimiter(limits.resendPerAddress);

  endpoint(router, '/auth/resend-verification/', {
    public: true,
    POST: async (req, res) => {
      const form = new Form(req.body);
      const username = form.text('username', { max: 254 });
      form.check();
      const lookup = username.includes('@') ? 'email' : 'username';
      const user = await db.get(`SELECT * FROM users WHERE LOWER(${lookup}) = LOWER(?)`, [username]);
      const accountKey = user ? `user:${user.id}` : `name:${username.toLowerCase()}`;
      const wait = Math.max(resendsPerAccount.retryAfter(accountKey), resendsPerAddress.retryAfter(req.ip));
      if (wait) {
        res.set('Retry-After', String(wait));
        throw fail(`Too many emails requested. Please wait ${minutes(wait)} and try again.`, 429);
      }
      resendsPerAccount.hit(accountKey);
      resendsPerAddress.hit(req.ip);
      if (user && user.is_active && !user.email_verified_at) await emailLink(user);
      // The same answer either way, so this doesn't reveal which accounts exist.
      return { message: 'If that account exists and isn’t verified yet, we’ve sent a new link to its email address. '
        + 'Check your inbox (and spam folder).' };
    },
  });

  endpoint(router, '/profile/', {
    uploads: true,
    // Always the signed-in user: there is no user id in the URL, so nobody can view or edit someone else's profile.
    GET: (req) => ({ user: userJson(req.user) }),
    POST: async (req) => {
      const user = req.user;
      const isOwner = user.role === 'owner';
      const form = new Form(req.body, req.filesByField);
      const values = {
        first_name: form.text('first_name', { max: 150 }),
        last_name: form.text('last_name', { max: 150 }),
        email: form.email('email'),
        phone: form.text('phone', { required: false, max: 20 }),
      };
      if (values.email && form.ok('email') && await emailTaken(db, values.email, user.id)) {
        form.error('email', 'That email is already used by another account.');
      }

      // Image fields work like a file input with a "Clear" checkbox.
      const imageFields = isOwner ? ['profile_photo', 'gcash_qr'] : ['profile_photo'];
      const imageChanges = {};
      for (const field of imageFields) {
        const file = form.file(field);
        const clear = ['on', 'true', '1'].includes(form.raw(`${field}-clear`));
        if (file && clear) {
          form.error(field, 'Please either submit a file or check the clear checkbox, not both.');
        } else if (file) {
          if (imageType(file)) imageChanges[field] = file;
          else form.error(field, INVALID_IMAGE);
        } else if (clear) {
          imageChanges[field] = null;
        }
      }

      // Only property owners receive rent, so only they set GCash details.
      if (isOwner) {
        values.gcash_name = form.text('gcash_name', { required: false, max: 100 });
        // Accept "0917 123 4567" or "0917-123-4567".
        const number = form.text('gcash_number', { required: false, max: 15 }).replace(/[\s-]/g, '');
        if (number && form.ok('gcash_number') && !GCASH_NUMBER_RE.test(number)) {
          form.error('gcash_number', 'Enter an 11-digit mobile number starting with 09, e.g. 09171234567.');
        }
        values.gcash_number = number;
        if (number && form.ok('gcash_number') && !values.gcash_name && form.ok('gcash_name')) {
          form.error('gcash_name', 'Enter the name on your GCash account so tenants can check they are paying you.');
        }
      }
      form.check();

      for (const [field, file] of Object.entries(imageChanges)) {
        const folder = field === 'gcash_qr' ? 'gcash_qr' : 'profile_photos';
        values[field] = file ? await saveImage(mediaDir, folder, file) : '';
        await deleteFile(mediaDir, user[field]);
      }
      // A new email address has to be verified too (needed for the next sign-in).
      const emailChanged = values.email !== user.email.toLowerCase();
      if (emailChanged) values.email_verified_at = null;
      const columns = Object.keys(values);
      await db.run(`UPDATE users SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
        [...columns.map((c) => values[c]), user.id]);
      const updated = await findUser(db, user.id);
      let message = 'Profile updated successfully.';
      if (emailChanged) {
        message = await emailLink(updated)
          ? `Profile updated. We sent a link to ${updated.email}. Open it to verify your new address; you’ll need it to sign in next time.`
          : 'Profile updated, but we couldn’t send a link to verify your new email. Use “Resend verification email” on the sign-in page.';
      }
      return { user: userJson(updated), message };
    },
  });

  endpoint(router, '/badges/', {
    // Sidebar "needs attention" counts.
    GET: async (req) => {
      const user = req.user;
      let pendingApplications = 0;
      let pendingPayments = 0;
      if (user.role === 'tenant') {
        pendingApplications = await count(db, "SELECT COUNT(*) AS n FROM applications WHERE tenant_id = ? AND status = 'pending'", [user.id]);
      } else if (user.role === 'owner' || user.role === 'manager') {
        pendingApplications = await count(db, `SELECT COUNT(*) AS n FROM applications a JOIN units u ON u.id = a.unit_id
          JOIN properties p ON p.id = u.property_id WHERE ${RUNS('p')} AND a.status = 'pending'`, [user.id, user.id]);
        pendingPayments = await countPendingPayments(db, user.id);
      }
      if (user.role === 'tenant') await remindTenant(db, user.id);
      const unread = await count(db, 'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', [user.id]);
      return { pending_applications: pendingApplications, pending_payments: pendingPayments, unread_notifications: unread };
    },
  });

  endpoint(router, '/dashboard/', {
    // The numbers for the signed-in user's own dashboard (one per role).
    GET: async (req) => {
      const builders = { admin: adminDashboard, owner: runnerDashboard, manager: runnerDashboard, tenant: tenantDashboard };
      return { role: req.user.role, ...(await builders[req.user.role](db, req.user)) };
    },
  });

  return router;
}

export async function count(db, sql, params = []) {
  return Number((await db.get(sql, params)).n);
}

/** GCash payments waiting for confirmation on properties the user owns or manages. */
function countPendingPayments(db, userId) {
  return count(db, `SELECT COUNT(*) AS n FROM payments pay JOIN applications a ON a.id = pay.tenancy_id
    JOIN units u ON u.id = a.unit_id JOIN properties p ON p.id = u.property_id
    WHERE ${RUNS('p')} AND pay.status = 'pending'`, [userId, userId]);
}

async function adminDashboard(db) {
  const counts = Object.fromEntries((await db.all('SELECT role, COUNT(*) AS n FROM users GROUP BY role'))
    .map((r) => [r.role, Number(r.n)]));
  const recent = await db.all('SELECT * FROM users ORDER BY date_joined DESC, id DESC LIMIT 8');
  return {
    total_users: await count(db, 'SELECT COUNT(*) AS n FROM users'),
    active_users: await count(db, 'SELECT COUNT(*) AS n FROM users WHERE is_active = 1'),
    role_counts: ROLES.map(([role, label]) => ({ role, label, count: counts[role] || 0 })),
    recent_users: recent.map((u) => ({
      ...userBrief(u, { contact: true }),
      role_display: ROLES.find(([r]) => r === u.role)?.[1],
      is_active: Boolean(u.is_active),
      date_joined: iso(u.date_joined),
    })),
  };
}

/** Owner and Property Manager dashboards: the properties they own or manage. */
async function runnerDashboard(db, user) {
  const pending = await db.all(
    `SELECT a.id, a.created_at, u.name AS unit_name, p.name AS property_name, a.tenant_id,
       t.username AS t_username, t.first_name AS t_first_name, t.last_name AS t_last_name,
       t.profile_photo AS t_profile_photo
     FROM applications a JOIN units u ON u.id = a.unit_id JOIN properties p ON p.id = u.property_id
     JOIN users t ON t.id = a.tenant_id
     WHERE ${RUNS('p')} AND a.status = 'pending'
     ORDER BY a.created_at DESC, a.id DESC`,
    [user.id, user.id],
  );
  const me = [user.id, user.id];
  const unitsSql = `SELECT COUNT(*) AS n FROM units u JOIN properties p ON p.id = u.property_id WHERE ${RUNS('p')}`;
  return {
    payments_to_confirm: await countPendingPayments(db, user.id),
    property_count: await count(db, `SELECT COUNT(*) AS n FROM properties p WHERE ${RUNS('p')}`, me),
    unit_count: await count(db, unitsSql, me),
    vacant_units: await count(db, `${unitsSql} AND u.status = 'vacant'`, me),
    app_pending: pending.length,
    recent_pending: pending.slice(0, 5).map((a) => ({
      id: a.id,
      tenant: userBrief({ id: a.tenant_id, username: a.t_username, first_name: a.t_first_name,
        last_name: a.t_last_name, profile_photo: a.t_profile_photo }),
      property_name: a.property_name,
      unit_name: a.unit_name,
      created_at: iso(a.created_at),
    })),
  };
}

async function tenantDashboard(db, user) {
  const ledgers = (await ledgersFor(db, await tenanciesFor(db, { tenantId: user.id })))
    .filter((l) => l.active || l.balance);
  const apps = (status) => count(db,
    `SELECT COUNT(*) AS n FROM applications WHERE tenant_id = ?${status ? ' AND status = ?' : ''}`,
    status ? [user.id, status] : [user.id]);
  return {
    rent: ledgers.map((l) => ({
      tenancy_id: l.tenancy.id,
      property_name: l.tenancy.property.name,
      unit_name: l.tenancy.unit.name,
      balance: money(l.balance),
      overdue: money(l.overdue),
      credit: money(l.credit),
      pending_total: money(l.pending_total),
      pending_count: l.pending_count,
      tenancy_start: iso(l.tenancy.start),
      current: l.current ? { period: l.current.charge.period, due_date: l.current.charge.due_date } : null,
    })),
    vacant_units: await count(db, "SELECT COUNT(*) AS n FROM units WHERE status = 'vacant'"),
    app_total: await apps(),
    app_pending: await apps('pending'),
    app_approved: await apps('approved'),
  };
}

