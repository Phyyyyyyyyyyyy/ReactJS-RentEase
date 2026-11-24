/**
 * In-app notifications: application results, payments, lease changes, and rent reminders.
 *
 *   await notify(db, userId, 'payment', 'Your ₱8,000.00 payment was confirmed.', '/payments');
 *
 * A `key` makes a notification one-time: notifying the same user with the
 * same key again does nothing (used for reminders).
 */
import { ledgersFor, monthStart, tenanciesFor } from './billing.js';
import { addDays, iso, nowIso, peso, today } from './lib/format.js';

export const NOTIFICATION_TYPES = ['application', 'payment', 'lease', 'reminder'];
const REMIND_DAYS_BEFORE_DUE = 5;

/** Notify one user or several (null/undefined ids are skipped, duplicates sent once). */
export async function notify(db, userIds, type, message, link = '', key = null) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean))];
  for (const userId of ids) {
    await db.run(
      `INSERT INTO notifications (user_id, type, message, link, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
      [userId, type, message, link, key, nowIso()],
    );
  }
}

/** The owner and the manager (if any) of the property a unit belongs to. */
export async function runnersOfUnit(db, unitId) {
  const row = await db.get(
    'SELECT p.owner_id, p.manager_id FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ?', [unitId]);
  return row ? [row.owner_id, row.manager_id] : [];
}

/**
 * Rent reminders for a tenant: one when this month's rent is due within 5 days
 * and unpaid, and one each month while anything is overdue. Created when the
 * tenant opens the app, so no scheduled job is needed; the key stops repeats.
 */
export async function remindTenant(db, tenantId, day = today()) {
  const ledgers = await ledgersFor(db, await tenanciesFor(db, { tenantId }), day);
  for (const l of ledgers) {
    if (!l.active || !l.balance) continue;
    const where = `${l.tenancy.property.name} ${l.tenancy.unit.name}`;
    if (l.overdue) {
      await notify(db, tenantId, 'reminder', `You have ${peso(l.overdue)} of overdue rent for ${where}. Please pay as soon as you can.`,
        '/payments', `overdue-${l.tenancy.id}-${monthStart(day)}`);
    }
    const current = l.current;
    if (current && current.remaining && addDays(day, REMIND_DAYS_BEFORE_DUE) >= current.charge.due_date) {
      await notify(db, tenantId, 'reminder', `Rent of ${peso(current.remaining)} for ${where} is due on ${current.charge.due_date}.`,
        '/payments', `due-${l.tenancy.id}-${current.charge.period}`);
    }
  }
}

export function notificationJson(n) {
  return { id: n.id, type: n.type, message: n.message, link: n.link, is_read: Boolean(n.is_read), created_at: iso(n.created_at) };
}
