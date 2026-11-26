/**
 * Leases: created when an application is approved, then renewed or terminated
 * by the owner or the property's manager. Rent is billed from the lease's start
 * date to its end date at its monthly rent (see billing.js).
 *
 * A rent-to-own lease also keeps the contract: price, term, interest rate (for
 * reference), and reservation fee. It runs for the whole term, and its
 * remaining balance is the contract price minus everything paid.
 */
import { leaseState, tenancyStart } from './billing.js';
import { addDays, addMonths, money, nowIso, today } from './lib/format.js';

export const LEASE_MONTHS = 12;
const STATE_LABEL = { active: 'Active', expired: 'Expired', terminated: 'Terminated' };
const TYPE_LABEL = { rent: 'Rent', rent_to_own: 'Rent-to-own' };

/**
 * Create the lease for a just-approved application from the unit's current terms.
 * `t` is a database or transaction; `unit` is the unit's row.
 */
export async function createLease(t, application, unit) {
  const start = tenancyStart(application);
  const rentToOwn = unit.listing_type === 'rent_to_own';
  const months = rentToOwn && unit.term_years ? unit.term_years * 12 : LEASE_MONTHS;
  const now = nowIso();
  return t.insert(
    `INSERT INTO leases (application_id, start_date, end_date, monthly_rent, deposit, status, created_at, updated_at,
       lease_type, contract_price, term_years, interest_rate_bp, reservation_fee, payment_interval_months)
     VALUES (?, ?, ?, ?, 0, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [application.id, start, addDays(addMonths(start, months), -1), unit.monthly_rent, now, now,
      rentToOwn ? 'rent_to_own' : 'rent', rentToOwn ? unit.contract_price : null, rentToOwn ? unit.term_years : null,
      rentToOwn ? unit.interest_rate_bp : null, rentToOwn ? unit.reservation_fee || 0 : 0, unit.payment_interval_months || 1],
  );
}

/**
 * Give a lease to approved applications from before leases existed, so every
 * tenancy has one. Safe to run on every start.
 */
export async function backfillLeases(db) {
  const missing = await db.all(
    `SELECT a.id, a.approved_at, a.preferred_move_in, u.monthly_rent, u.listing_type, u.contract_price, u.term_years,
       u.interest_rate_bp, u.reservation_fee, u.payment_interval_months
     FROM applications a JOIN units u ON u.id = a.unit_id LEFT JOIN leases l ON l.application_id = a.id
     WHERE a.status = 'approved' AND a.approved_at IS NOT NULL AND l.id IS NULL`,
  );
  for (const row of missing) await createLease(db, row, row);
  return missing.length;
}

export function leaseJson(lease, day = today()) {
  if (!lease) return null;
  const state = leaseState(lease, day);
  const rentToOwn = lease.lease_type === 'rent_to_own';
  return {
    id: lease.id,
    type: rentToOwn ? 'rent_to_own' : 'rent',
    type_display: TYPE_LABEL[rentToOwn ? 'rent_to_own' : 'rent'],
    start_date: lease.start_date,
    end_date: lease.end_date,
    monthly_rent: money(lease.monthly_rent),
    payment_interval_months: lease.payment_interval_months || 1,
    payment_terms: !lease.payment_interval_months || lease.payment_interval_months === 1 ? 'Monthly' : `Every ${lease.payment_interval_months} months`,
    // What each bill is: the monthly rate times the months it covers.
    amount_per_payment: money(lease.monthly_rent * (lease.payment_interval_months || 1)),
    deposit: money(lease.deposit),
    ...(rentToOwn ? {
      contract_price: money(lease.contract_price),
      term_years: lease.term_years,
      interest_rate: lease.interest_rate_bp === null || lease.interest_rate_bp === undefined ? null : money(lease.interest_rate_bp),
      reservation_fee: money(lease.reservation_fee),
    } : {}),
    status: state,
    status_display: STATE_LABEL[state],
    is_active: state === 'active',
    can_renew: state !== 'terminated',
    can_terminate: state === 'active',
  };
}
