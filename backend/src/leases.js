/**
 * Leases: created when an application is approved, then renewed or terminated
 * by the owner or the property's manager. Rent is billed from the lease's start
 * date to its end date at its monthly rent (see billing.js).
 */
import { leaseState, tenancyStart } from './billing.js';
import { addDays, addMonths, money, nowIso, today } from './lib/format.js';

export const LEASE_MONTHS = 12;
const STATE_LABEL = { active: 'Active', expired: 'Expired', terminated: 'Terminated' };

/** Create the lease for a just-approved application. `t` is a database or transaction. */
export async function createLease(t, application, monthlyRent) {
  const start = tenancyStart(application);
  const now = nowIso();
  return t.insert(
    `INSERT INTO leases (application_id, start_date, end_date, monthly_rent, deposit, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 'active', ?, ?)`,
    [application.id, start, addDays(addMonths(start, LEASE_MONTHS), -1), monthlyRent, now, now],
  );
}

/**
 * Give a lease to approved applications from before leases existed, so every
 * tenancy has one. Safe to run on every start.
 */
export async function backfillLeases(db) {
  const missing = await db.all(
    `SELECT a.id, a.approved_at, a.preferred_move_in, u.monthly_rent FROM applications a
     JOIN units u ON u.id = a.unit_id LEFT JOIN leases l ON l.application_id = a.id
     WHERE a.status = 'approved' AND a.approved_at IS NOT NULL AND l.id IS NULL`,
  );
  for (const application of missing) await createLease(db, application, application.monthly_rent);
  return missing.length;
}

export function leaseJson(lease, day = today()) {
  if (!lease) return null;
  const state = leaseState(lease, day);
  return {
    id: lease.id,
    start_date: lease.start_date,
    end_date: lease.end_date,
    monthly_rent: money(lease.monthly_rent),
    deposit: money(lease.deposit),
    status: state,
    status_display: STATE_LABEL[state],
    is_active: state === 'active',
    can_renew: state !== 'terminated',
    can_terminate: state === 'active',
  };
}
