/**
 * Admin API: manage user accounts and roles (Users & Access).
 *
 * This replaces the Django admin site the Python version used. Admins can
 * list and search users, create accounts with any role (including Admin and
 * Staff, which can't self-register), change roles, reset passwords, and
 * deactivate accounts. Deactivated users are signed out and can't sign in.
 */
import { Router } from 'express';
import { isUniqueViolation } from '../db.js';
import { Form } from '../lib/forms.js';
import { endpoint, formErrors, notFound, reply } from '../lib/http.js';
import { nowIso } from '../lib/format.js';
import { hashPassword } from '../lib/passwords.js';
import { emailTaken, findUser, ROLES, userJson } from '../users.js';
import { validateNewAccount, validateNewPassword } from './accounts.js';

const ADMIN = ['admin'];

export default function adminRoutes(db) {
  const router = Router();

  const target = async (req) => {
    const n = Number(req.params.id);
    const user = Number.isSafeInteger(n) && n > 0 && await findUser(db, n);
    if (!user) throw notFound();
    return user;
  };

  endpoint(router, '/admin/users/', {
    roles: ADMIN,
    GET: async (req) => {
      const q = String(req.query.q ?? '').trim().toLowerCase();
      const role = String(req.query.role ?? '');
      const where = [];
      const params = [];
      if (q) {
        const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        where.push(`(${['username', 'email', 'first_name', 'last_name'].map((c) => `LOWER(${c}) LIKE ? ESCAPE '\\'`).join(' OR ')})`);
        params.push(like, like, like, like);
      }
      if (ROLES.some(([r]) => r === role)) {
        where.push('role = ?');
        params.push(role);
      }
      const users = await db.all(
        `SELECT * FROM users ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY date_joined DESC, id DESC`,
        params,
      );
      const counts = Object.fromEntries((await db.all('SELECT role, COUNT(*) AS n FROM users GROUP BY role'))
        .map((r) => [r.role, Number(r.n)]));
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      return {
        users: users.map(userJson),
        role_tabs: [{ value: '', label: 'All', count: total },
          ...ROLES.map(([value, label]) => ({ value, label, count: counts[value] || 0 }))],
      };
    },
    POST: async (req) => {
      const form = new Form(req.body);
      const values = await validateNewAccount(db, form, ROLES);
      form.check();
      let id;
      try {
        id = await db.insert(
          // An admin vouches for accounts they create, so these are already verified.
          `INSERT INTO users (username, email, password, first_name, last_name, role, phone, date_joined, email_verified_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [values.username, values.email, await hashPassword(values.password), values.first_name, values.last_name,
            values.role, values.phone, nowIso(), nowIso()],
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw formErrors({ username: ['This username is already taken.'] });
        throw error;
      }
      const user = await findUser(db, id);
      return reply(201, { user: userJson(user), message: `Account ${user.username} created.` });
    },
  });

  endpoint(router, '/admin/users/:id/', {
    roles: ADMIN,
    GET: async (req) => ({ user: userJson(await target(req)) }),
    PUT: async (req) => {
      const user = await target(req);
      const self = user.id === req.user.id;
      const form = new Form(req.body);
      const values = {
        first_name: form.text('first_name', { max: 150 }),
        last_name: form.text('last_name', { max: 150 }),
        email: form.email('email'),
        phone: form.text('phone', { required: false, max: 20 }),
        role: form.choice('role', ROLES),
        is_active: ['true', 'on', '1'].includes(form.raw('is_active').toLowerCase()) ? 1 : 0,
      };
      if (values.email && form.ok('email') && await emailTaken(db, values.email, user.id)) {
        form.error('email', 'That email is already used by another account.');
      }
      // Admins can't lock themselves out.
      if (self && values.role && values.role !== 'admin') form.error('role', 'You can’t remove your own Admin role.');
      if (self && !values.is_active) form.error('is_active', 'You can’t deactivate your own account.');
      // Admins can mark an email verified (e.g. if the person never got the link) or unverified.
      if (form.has('email_verified')) {
        const verified = ['true', 'on', '1'].includes(form.raw('email_verified').toLowerCase());
        if (self && !verified) form.error('email_verified', 'You can’t unverify your own email.');
        values.email_verified_at = verified ? (user.email_verified_at || nowIso()) : null;
      }
      const password = validateNewPassword(form, { ...user, ...values }, { required: false });
      form.check();

      const columns = Object.keys(values);
      const params = columns.map((c) => values[c]);
      let sql = `UPDATE users SET ${columns.map((c) => `${c} = ?`).join(', ')}`;
      if (password) {
        sql += ', password = ?';
        params.push(await hashPassword(password));
      }
      await db.run(`${sql} WHERE id = ?`, [...params, user.id]);
      // A new password or a deactivated account ends that user's sessions.
      if ((password && !self) || !values.is_active) await db.run('DELETE FROM sessions WHERE user_id = ?', [user.id]);
      const updated = await findUser(db, user.id);
      return { user: userJson(updated), message: `Account ${updated.username} updated.` };
    },
  });

  return router;
}
