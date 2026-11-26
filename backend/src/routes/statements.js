/**
 * Statement of account for one tenancy, like a landlord's spreadsheet: the
 * contract terms at the top, then every confirmed payment (date, description,
 * amount, mode), then the totals. For rent-to-own, the remaining balance is the
 * contract price minus everything paid (reservation included).
 *
 * Only the tenant, the property's owner, and its manager can see it.
 */
import { Router } from 'express';
import { ledgerFor, tenanciesFor } from '../billing.js';
import { endpoint, notFound } from '../lib/http.js';
import { money, today } from '../lib/format.js';
import { leaseJson } from '../leases.js';
import { displayName } from '../users.js';
import { KIND_LABEL, METHOD_LABEL } from './payments.js';

/** One CSV cell; text starting with = + - @ is prefixed so spreadsheets don't run it as a formula. */
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function buildStatement(db, tenancy) {
  const property = await db.get('SELECT * FROM properties WHERE id = ?', [tenancy.property.id]);
  const ledger = await ledgerFor(db, tenancy);
  const payments = await db.all(
    `SELECT * FROM payments WHERE tenancy_id = ? AND status = 'confirmed' ORDER BY paid_on, created_at, id`, [tenancy.id]);
  const lease = tenancy.lease;
  const rentToOwn = lease?.lease_type === 'rent_to_own';
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const reservationPaid = payments.filter((p) => p.kind === 'reservation').reduce((sum, p) => sum + p.amount, 0);
  const contractPrice = rentToOwn ? lease.contract_price || 0 : null;
  return {
    as_of: today(),
    tenancy_id: tenancy.id,
    to: { full_name: displayName(tenancy.tenant), email: tenancy.tenant.email },
    owner: displayName(tenancy.owner),
    property: { name: property.name, address: property.address, city: property.city },
    unit: tenancy.unit.name,
    lease: leaseJson(lease),
    is_rent_to_own: rentToOwn,
    payments: payments.map((p, i) => ({
      no: i + 1,
      id: p.id,
      date: p.paid_on,
      description: KIND_LABEL[p.kind || 'monthly'],
      amount: money(p.amount),
      mode: METHOD_LABEL[p.method],
      reference_number: p.reference_number,
      note: p.note,
    })),
    totals: {
      payments: payments.length,
      total_paid: money(totalPaid),
      reservation_paid: money(reservationPaid),
      rent_paid: money(totalPaid - reservationPaid),
      // Rent-to-own: what's left of the contract price.
      contract_price: rentToOwn ? money(contractPrice) : null,
      remaining_balance: rentToOwn ? money(Math.max(contractPrice - totalPaid, 0)) : null,
      percent_paid: rentToOwn && contractPrice ? Math.min(100, Math.round((totalPaid / contractPrice) * 1000) / 10) : null,
      // Bills due so far that aren't paid yet (all tenancies).
      balance_due: money(ledger.balance),
      overdue: money(ledger.overdue),
      credit: money(ledger.credit),
    },
  };
}

export default function statementsRoutes(db) {
  const router = Router();

  // The tenant, or the owner or manager of the property; anyone else gets a 404.
  async function visibleTenancy(req) {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw notFound();
    const [tenancy] = await tenanciesFor(db, { id });
    if (!tenancy) throw notFound();
    const property = await db.get('SELECT owner_id, manager_id FROM properties WHERE id = ?', [tenancy.property.id]);
    const me = req.user.id;
    if (me !== tenancy.tenant_id && me !== property.owner_id && me !== property.manager_id) throw notFound();
    return tenancy;
  }

  endpoint(router, '/payments/:id/statement/', {
    roles: ['tenant', 'owner', 'manager'],
    GET: async (req) => ({ statement: await buildStatement(db, await visibleTenancy(req)) }),
  });

  endpoint(router, '/payments/:id/statement/export/', {
    roles: ['tenant', 'owner', 'manager'],
    GET: async (req, res) => {
      const s = await buildStatement(db, await visibleTenancy(req));
      const l = s.lease;
      const lines = [
        ['Statement of Account'],
        [],
        ['Date', `As of ${s.as_of}`],
        ['To', `${s.to.full_name} (${s.to.email})`],
        ['Re', `${s.unit}, ${s.property.name}, ${s.property.address}, ${s.property.city}`],
        ...(l ? [
          ['Type', l.type_display],
          ...(s.is_rent_to_own ? [
            ['Term', `${l.term_years} yrs / Rent to Own`],
            ['Contract price (PHP)', l.contract_price],
            ['Interest rate', l.interest_rate === null ? '' : `${l.interest_rate}% per annum`],
            ['Reservation fee (PHP)', l.reservation_fee],
          ] : []),
          ['Payment terms', `${l.payment_terms}, PHP ${l.amount_per_payment} per payment`],
          ['Lease', `${l.start_date} to ${l.end_date} (${l.status_display})`],
        ] : []),
        [],
        ['No.', 'Payment', 'Date', 'Amount (PHP)', 'Mode of payment', 'Reference no.', 'Note'],
        ...s.payments.map((p) => [p.no, p.description, p.date, p.amount, p.mode, p.reference_number, p.note]),
        [],
        ['Total paid (PHP)', s.totals.total_paid],
        ...(s.is_rent_to_own ? [
          ['Remaining balance (PHP)', s.totals.remaining_balance],
          ['Paid so far', `${s.totals.percent_paid}%`],
        ] : []),
        ['Balance due now (PHP)', s.totals.balance_due],
      ];
      const csv = `﻿${lines.map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
      const safeName = `${s.property.name}-${s.unit}`.replace(/[^\w-]+/g, '-').slice(0, 60);
      res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="statement-${safeName}-${s.as_of}.csv"`,
      }).send(csv);
    },
  });

  return router;
}
