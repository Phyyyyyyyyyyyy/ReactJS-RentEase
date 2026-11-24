/**
 * Rent billing: monthly charges and what a tenant owes.
 *
 * A tenancy is an approved application. While its unit is occupied, the tenant
 * owes one rent charge per month, starting the month they move in (never before
 * approval), due on the last day of that month. Charges are created when a
 * payments page or dashboard is opened, so no scheduled job is needed.
 *
 * A payment counts only once it is confirmed. GCash payments submitted by the
 * tenant wait for the owner to confirm them; payments the owner records count
 * right away. Confirmed money pays off the oldest month first, and anything
 * extra is credit for future months.
 */
import { localDate, nowIso, today } from './lib/format.js';

export const monthStart = (date) => `${date.slice(0, 8)}01`;

export function monthEnd(date) {
  const [y, m] = date.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 8)}${String(lastDay).padStart(2, '0')}`;
}

export function nextMonth(date) {
  let [y, m] = date.split('-').map(Number);
  m += 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

/** First day the tenant is renting: the preferred move-in date, but never before approval. */
export function tenancyStart(application) {
  if (!application.approved_at) return null;
  const approved = localDate(application.approved_at);
  const moveIn = application.preferred_move_in;
  return moveIn && moveIn > approved ? moveIn : approved;
}

const PERSON = (alias) => ['username', 'first_name', 'last_name', 'email', 'phone', 'profile_photo']
  .map((col) => `${alias}.${col} AS ${alias}_${col}`).join(', ');

const TENANCY_SELECT = `
  SELECT a.id, a.tenant_id, a.unit_id, a.preferred_move_in, a.approved_at,
    u.name AS unit_name, u.monthly_rent AS unit_rent, u.status AS unit_status,
    p.id AS property_id, p.name AS property_name, p.owner_id,
    ${PERSON('t')}, ${PERSON('o')},
    o.gcash_name AS o_gcash_name, o.gcash_number AS o_gcash_number, o.gcash_qr AS o_gcash_qr,
    l.id AS lease_id, l.start_date AS lease_start, l.end_date AS lease_end, l.monthly_rent AS lease_rent,
    l.deposit AS lease_deposit, l.status AS lease_status, l.terminated_at AS lease_terminated_at
  FROM applications a
  JOIN units u ON u.id = a.unit_id
  JOIN properties p ON p.id = u.property_id
  JOIN users t ON t.id = a.tenant_id
  JOIN users o ON o.id = p.owner_id
  LEFT JOIN leases l ON l.application_id = a.id
  WHERE a.status = 'approved' AND a.approved_at IS NOT NULL`;

/** Columns named `<prefix>_x` in `row`, as an object { id, x, ... }. */
export function person(row, prefix, id) {
  const result = { id };
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith(`${prefix}_`)) result[key.slice(prefix.length + 1)] = value;
  }
  return result;
}

function tenancyFromRow(r) {
  const lease = r.lease_id ? {
    id: r.lease_id, start_date: r.lease_start, end_date: r.lease_end, monthly_rent: r.lease_rent,
    deposit: r.lease_deposit, status: r.lease_status, terminated_at: r.lease_terminated_at,
  } : null;
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    unit_id: r.unit_id,
    preferred_move_in: r.preferred_move_in,
    approved_at: r.approved_at,
    // Tenancies approved before leases existed have no lease: billed from approval at the unit's rent.
    lease,
    start: lease ? lease.start_date : tenancyStart(r),
    rent: lease ? lease.monthly_rent : r.unit_rent,
    tenant: person(r, 't', r.tenant_id),
    owner: person(r, 'o', r.owner_id),
    unit: { id: r.unit_id, name: r.unit_name, monthly_rent: r.unit_rent, status: r.unit_status },
    property: { id: r.property_id, name: r.property_name },
  };
}

/** Approved applications (tenancies), newest approval first. Filter by tenant, owner, owner-or-manager, and/or id. */
export async function tenanciesFor(db, { tenantId, ownerId, runnerId, id } = {}) {
  let sql = TENANCY_SELECT;
  const params = [];
  if (tenantId !== undefined) { sql += ' AND a.tenant_id = ?'; params.push(tenantId); }
  if (ownerId !== undefined) { sql += ' AND p.owner_id = ?'; params.push(ownerId); }
  // Properties the user owns or manages.
  if (runnerId !== undefined) { sql += ' AND (p.owner_id = ? OR p.manager_id = ?)'; params.push(runnerId, runnerId); }
  if (id !== undefined) { sql += ' AND a.id = ?'; params.push(id); }
  sql += ' ORDER BY a.approved_at DESC, a.id DESC';
  return (await db.all(sql, params)).map(tenancyFromRow);
}

/** For each unit, the id of the most recently approved application. */
export async function latestApprovedByUnit(db, unitIds) {
  const latest = new Map();
  const ids = [...new Set(unitIds)];
  if (!ids.length) return latest;
  const rows = await db.all(
    `SELECT id, unit_id FROM applications
     WHERE status = 'approved' AND approved_at IS NOT NULL AND unit_id IN (${ids.map(() => '?').join(', ')})
     ORDER BY unit_id, approved_at DESC, id DESC`,
    ids,
  );
  for (const row of rows) if (!latest.has(row.unit_id)) latest.set(row.unit_id, row.id);
  return latest;
}

/** 'active', 'expired' (past its end date), or 'terminated'. */
export function leaseState(lease, day = today()) {
  if (lease.status === 'terminated') return 'terminated';
  return lease.end_date < day ? 'expired' : 'active';
}

/**
 * A tenancy is active while its unit is occupied, no later tenant was approved
 * for that unit, and its lease (if it has one) is neither terminated nor expired.
 */
export const isActive = (tenancy, latest, day = today()) =>
  tenancy.unit.status === 'occupied' && latest.get(tenancy.unit_id) === tenancy.id
  && (!tenancy.lease || leaseState(tenancy.lease, day) === 'active');

/**
 * Create any missing monthly charges from the tenancy's first month up to this
 * month, or up to the lease's last month if it has ended.
 */
export async function syncCharges(db, tenancy, day = today()) {
  const start = tenancy.start;
  if (!start || start > day) return;
  if (tenancy.lease && tenancy.lease.end_date < start) return; // ended before it began
  const last = tenancy.lease && tenancy.lease.end_date < day ? tenancy.lease.end_date : day;
  const existing = new Set((await db.all('SELECT period FROM rent_charges WHERE tenancy_id = ?', [tenancy.id]))
    .map((r) => r.period));
  const created = nowIso();
  for (let period = monthStart(start); period <= last; period = nextMonth(period)) {
    if (existing.has(period)) continue;
    await db.run(
      `INSERT INTO rent_charges (tenancy_id, period, amount, due_date, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
      [tenancy.id, period, tenancy.rent, monthEnd(period), created],
    );
  }
}

const LINE_LABELS = { paid: 'Paid', partial: 'Partly paid', due: 'Due', overdue: 'Overdue' };

/** What the tenant owes: one line per month, plus totals. All amounts in centavos. */
export async function buildLedger(db, tenancy, { active = true, day = today() } = {}) {
  // An ended lease (expired or terminated) still gets its remaining months up to its end date.
  if (active || (tenancy.lease && leaseState(tenancy.lease, day) !== 'active')) await syncCharges(db, tenancy, day);
  const charges = await db.all('SELECT * FROM rent_charges WHERE tenancy_id = ? ORDER BY period', [tenancy.id]);
  const totals = {};
  const counts = {};
  for (const row of await db.all(
    'SELECT status, SUM(amount) AS total, COUNT(*) AS n FROM payments WHERE tenancy_id = ? GROUP BY status',
    [tenancy.id],
  )) {
    totals[row.status] = Number(row.total);
    counts[row.status] = Number(row.n);
  }

  const totalCharged = charges.reduce((sum, c) => sum + c.amount, 0);
  const totalPaid = totals.confirmed || 0;

  // Apply confirmed payments to the oldest month first.
  const lines = [];
  let available = totalPaid;
  let running = 0;
  for (const charge of charges) {
    const paid = Math.min(available, charge.amount);
    available -= paid;
    const remaining = charge.amount - paid;
    running += remaining;
    let state;
    if (remaining === 0) state = 'paid';
    else if (charge.due_date < day) state = 'overdue';
    else if (paid > 0) state = 'partial';
    else state = 'due';
    lines.push({ charge, paid, remaining, through_total: running, state, label: LINE_LABELS[state] });
  }

  const rent = tenancy.rent;
  const balance = Math.max(totalCharged - totalPaid, 0);
  const credit = Math.max(totalPaid - totalCharged, 0);
  const last = lines.at(-1);
  return {
    tenancy,
    active,
    today: day,
    lines,
    total_charged: totalCharged,
    total_paid: totalPaid,
    pending_total: totals.pending || 0,
    pending_count: counts.pending || 0,
    balance,
    credit,
    overdue: lines.filter((l) => l.state === 'overdue').reduce((sum, l) => sum + l.remaining, 0),
    // This month's line, if the tenancy has started.
    current: last && last.charge.period === monthStart(day) ? last : null,
    // How many future months the credit pays for at the current rent.
    months_covered: rent ? Math.floor(credit / rent) : 0,
    // Prefill for a payment form: the balance, or one month's rent if nothing is owed (paying ahead).
    suggested_amount: balance || rent,
  };
}

/** The ledger of one tenancy, working out whether it is still active. */
export async function ledgerFor(db, tenancy) {
  const latest = await latestApprovedByUnit(db, [tenancy.unit_id]);
  return buildLedger(db, tenancy, { active: isActive(tenancy, latest) });
}

/** Ledgers for active tenancies, plus ended ones that still have charges or payments on record. */
export async function ledgersFor(db, tenancies, day = today()) {
  const latest = await latestApprovedByUnit(db, tenancies.map((t) => t.unit_id));
  const ledgers = [];
  for (const tenancy of tenancies) {
    const active = isActive(tenancy, latest, day);
    if (!active && !tenancy.lease) {
      const hasRecords = await db.get(
        `SELECT 1 AS x FROM rent_charges WHERE tenancy_id = ?
         UNION ALL SELECT 1 AS x FROM payments WHERE tenancy_id = ?`,
        [tenancy.id, tenancy.id],
      );
      if (!hasRecords) continue;
    }
    ledgers.push(await buildLedger(db, tenancy, { active, day }));
  }
  return ledgers;
}
