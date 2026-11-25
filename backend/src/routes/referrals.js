/** Admin API: create, list, enable/disable, and delete referral codes. */
import { Router } from 'express';
import { isUniqueViolation } from '../db.js';
import { Form } from '../lib/forms.js';
import { endpoint, fail, formErrors, notFound, reply } from '../lib/http.js';
import { nowIso } from '../lib/format.js';
import { CUSTOM_CODE_RE, generateCode, normalizeCode, referralJson } from '../referrals.js';
import { REFERRAL_ROLES, ROLE_LABEL } from '../users.js';

const ADMIN = ['admin'];
const LIST_SQL = `
  SELECT rc.*, c.username AS creator_username, c.first_name AS creator_first_name, c.last_name AS creator_last_name,
    (SELECT COUNT(*) FROM users u WHERE u.referral_code_id = rc.id) AS uses
  FROM referral_codes rc LEFT JOIN users c ON c.id = rc.created_by_id`;

export default function referralsRoutes(db) {
  const router = Router();

  const target = async (req) => {
    const id = Number(req.params.id);
    const row = Number.isSafeInteger(id) && id > 0 && await db.get(`${LIST_SQL} WHERE rc.id = ?`, [id]);
    if (!row) throw notFound();
    return row;
  };

  endpoint(router, '/admin/referral-codes/', {
    roles: ADMIN,
    GET: async () => ({
      codes: (await db.all(`${LIST_SQL} ORDER BY rc.created_at DESC, rc.id DESC`)).map(referralJson),
      roles: REFERRAL_ROLES.map(([value, label]) => ({ value, label })),
    }),
    POST: async (req) => {
      const form = new Form(req.body);
      const role = form.choice('role', REFERRAL_ROLES);
      const label = form.text('label', { required: false, max: 100 });
      // Leave the code empty to generate a random one, or type your own.
      const custom = normalizeCode(form.text('code', { required: false, max: 32 }));
      if (custom && form.ok('code') && !CUSTOM_CODE_RE.test(custom)) {
        form.error('code', 'Use 4–32 letters, numbers, or dashes.');
      }
      form.check();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = custom || generateCode();
        try {
          const id = await db.insert(
            'INSERT INTO referral_codes (code, role, label, is_active, created_by_id, created_at) VALUES (?, ?, ?, 1, ?, ?)',
            [code, role, label, req.user.id, nowIso()],
          );
          const row = await db.get(`${LIST_SQL} WHERE rc.id = ?`, [id]);
          return reply(201, { code: referralJson(row), message: `Referral code ${code} created for ${ROLE_LABEL[role]} accounts.` });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          if (custom) throw formErrors({ code: ['That code already exists. Choose another.'] });
          // A random code clashed (extremely unlikely): try another.
        }
      }
      throw fail('Could not create a unique code. Please try again.');
    },
  });

  endpoint(router, '/admin/referral-codes/:id/', {
    roles: ADMIN,
    // Turn a code on or off, or change its label. Disabling stops new sign-ups; existing accounts are unaffected.
    PUT: async (req) => {
      const row = await target(req);
      const form = new Form(req.body);
      const label = form.has('label') ? form.text('label', { required: false, max: 100 }) : row.label;
      const active = form.has('is_active') ? ['true', 'on', '1'].includes(form.raw('is_active').toLowerCase()) : Boolean(row.is_active);
      form.check();
      await db.run('UPDATE referral_codes SET label = ?, is_active = ? WHERE id = ?', [label, active ? 1 : 0, row.id]);
      return {
        code: referralJson(await target(req)),
        message: `Referral code ${row.code} ${active ? 'is active' : 'is disabled'}.`,
      };
    },
    // Only unused codes can be deleted; used ones are disabled instead so the record stays.
    DELETE: async (req) => {
      const row = await target(req);
      if (Number(row.uses) > 0) throw fail('This code has been used to create accounts, so it can only be disabled.');
      await db.run('DELETE FROM referral_codes WHERE id = ?', [row.id]);
      return { message: `Referral code ${row.code} deleted.` };
    },
  });

  return router;
}
