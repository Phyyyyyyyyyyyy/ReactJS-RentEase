/**
 * Rent payments API for tenants and property owners.
 *
 * Tenant queries are filtered by the signed-in tenant and owner queries by the
 * signed-in owner's properties, so nobody can see or change another person's
 * payments (they get a 404).
 */
import { Router } from 'express';
import { ledgerFor, ledgersFor, person, tenanciesFor } from '../billing.js';
import { isUniqueViolation } from '../db.js';
import { deleteFile, fileUrl, imageType, INVALID_IMAGE, saveImage } from '../lib/files.js';
import { Form } from '../lib/forms.js';
import { endpoint, fail, formErrors, notFound, reply } from '../lib/http.js';
import { iso, money, nowIso, peso, today } from '../lib/format.js';
import { leaseJson } from '../leases.js';
import { acceptsGcash, displayName, userBrief } from '../users.js';
import { notify, runnersOfUnit } from '../notifications.js';
import { RUNNERS, RUNS } from './properties.js';

// Mode of payment.
export const PAYMENT_METHODS = [
  ['gcash', 'GCash'],
  ['cash', 'Cash (in person)'],
  ['check', 'Check deposit'],
  ['online_bank', 'Online bank deposit'],
  ['bank', 'Bank transfer'],
  ['other', 'Other'],
];
export const METHOD_LABEL = Object.fromEntries(PAYMENT_METHODS);

// What the payment is for. Reservation payments count toward a rent-to-own
// contract price but not toward the regular (monthly) bills.
export const PAYMENT_KINDS = [
  ['monthly', 'Rent payment'],
  ['reservation', 'Reservation payment'],
  ['other', 'Other payment'],
];
export const KIND_LABEL = Object.fromEntries(PAYMENT_KINDS);
const STATUS_LABEL = { pending: 'Awaiting confirmation', confirmed: 'Confirmed', rejected: 'Rejected' };

// GCash reference numbers are 13 digits (shown on the receipt after sending money).
const GCASH_REFERENCE_RE = /^\d{13}$/;
const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const VOIDED = 'Voided by owner';

const TENANT = ['tenant'];

// ------------------------------------------------------------------ JSON shapes

function lineJson(line) {
  return {
    period: line.charge.period,
    due_date: line.charge.due_date,
    amount: money(line.charge.amount),
    paid: money(line.paid),
    remaining: money(line.remaining),
    through_total: money(line.through_total),
    state: line.state,
    label: line.label,
  };
}

function tenancyJson(t) {
  return {
    id: t.id,
    tenancy_start: iso(t.start),
    tenant: userBrief(t.tenant, { contact: true }),
    unit: {
      id: t.unit.id, name: t.unit.name, monthly_rent: money(t.unit.monthly_rent),
      property: { id: t.property.id, name: t.property.name },
    },
    owner: { ...userBrief(t.owner), phone: t.owner.phone, accepts_gcash: acceptsGcash(t.owner) },
    lease: leaseJson(t.lease),
  };
}

function ledgerJson(l) {
  return {
    tenancy: tenancyJson(l.tenancy),
    active: l.active,
    balance: money(l.balance),
    credit: money(l.credit),
    overdue: money(l.overdue),
    total_charged: money(l.total_charged),
    total_paid: money(l.total_paid),
    pending_total: money(l.pending_total),
    pending_count: l.pending_count,
    months_covered: l.months_covered,
    suggested_amount: money(l.suggested_amount),
    current: l.current ? lineJson(l.current) : null,
    lines: [...l.lines].reverse().map(lineJson), // newest month first
  };
}

const PAYMENT_SELECT = `
  SELECT pay.*, a.tenant_id, a.unit_id, u.name AS unit_name, p.name AS property_name, p.owner_id, p.manager_id,
    t.username AS t_username, t.first_name AS t_first_name, t.last_name AS t_last_name,
    t.profile_photo AS t_profile_photo
  FROM payments pay
  JOIN applications a ON a.id = pay.tenancy_id
  JOIN units u ON u.id = a.unit_id
  JOIN properties p ON p.id = u.property_id
  JOIN users t ON t.id = a.tenant_id`;
const PAYMENT_ORDER = 'ORDER BY pay.paid_on DESC, pay.created_at DESC, pay.id DESC';

function paymentJson(p, user) {
  return {
    id: p.id,
    amount: money(p.amount),
    method: p.method,
    method_display: METHOD_LABEL[p.method],
    kind: p.kind || 'monthly',
    kind_display: KIND_LABEL[p.kind || 'monthly'],
    reference_number: p.reference_number,
    proof: fileUrl(p.proof),
    paid_on: p.paid_on,
    note: p.note,
    status: p.status,
    status_display: STATUS_LABEL[p.status],
    owner_note: p.owner_note,
    voided: p.status === 'rejected' && p.owner_note === VOIDED,
    created_at: iso(p.created_at),
    recorded_by_owner: p.recorded_by_id !== null && p.recorded_by_id !== p.tenant_id,
    recorded_by_me: p.recorded_by_id === user.id,
    tenancy: {
      id: p.tenancy_id,
      tenant: userBrief(person(p, 't', p.tenant_id)),
      unit: { id: p.unit_id, name: p.unit_name, property: { name: p.property_name } },
    },
  };
}

// ------------------------------------------------------------------------ forms

function paidOn(form) {
  const date = form.date('paid_on');
  if (date && date > today()) form.error('paid_on', 'The payment date cannot be in the future.');
  return date;
}

async function referenceInUse(db, reference) {
  return db.get(
    "SELECT 1 AS x FROM payments WHERE method = 'gcash' AND reference_number = ? AND status <> 'rejected'",
    [reference],
  );
}

// ---------------------------------------------------------------------- routes

export default function paymentsRoutes(db, { mediaDir }) {
  const router = Router();
  const id = (req) => {
    const n = Number(req.params.id);
    if (!Number.isSafeInteger(n) || n <= 0) throw notFound();
    return n;
  };

  // ---------------------------------------------------------------- tenant

  endpoint(router, '/payments/', {
    roles: TENANT,
    GET: async (req) => {
      const ledgers = await ledgersFor(db, await tenanciesFor(db, { tenantId: req.user.id }));
      const history = await db.all(`${PAYMENT_SELECT} WHERE a.tenant_id = ? ${PAYMENT_ORDER}`, [req.user.id]);
      return { ledgers: ledgers.map(ledgerJson), history: history.map((p) => paymentJson(p, req.user)) };
    },
  });

  endpoint(router, '/payments/:id/gcash/', {
    roles: TENANT,
    uploads: true,
    GET: async (req) => {
      const tenancy = await tenantTenancy(req);
      const owner = tenancy.owner;
      return {
        ledger: ledgerJson(await ledgerFor(db, tenancy)),
        gcash: { name: owner.gcash_name, number: owner.gcash_number, qr: fileUrl(owner.gcash_qr) },
        today: today(),
      };
    },
    POST: async (req) => {
      const tenancy = await tenantTenancy(req);
      const form = new Form(req.body, req.filesByField);
      const amount = form.money('amount', { min: 1 });
      const reference = form.text('reference_number', { max: 20 });
      if (reference && form.ok('reference_number')) {
        if (!GCASH_REFERENCE_RE.test(reference)) {
          form.error('reference_number', 'Enter the 13-digit reference number from your GCash receipt.');
        } else if (await referenceInUse(db, reference)) {
          form.error('reference_number', 'This reference number has already been submitted.');
        }
      }
      const date = paidOn(form);
      const note = form.text('note', { required: false, max: 255 });
      const proof = form.file('proof');
      if (proof) {
        if (!imageType(proof)) form.error('proof', INVALID_IMAGE);
        else if (proof.size > MAX_PROOF_BYTES) form.error('proof', 'The screenshot must be 5 MB or smaller.');
      }
      form.check();

      const proofPath = proof ? await saveImage(mediaDir, 'payment_proofs', proof) : '';
      try {
        await db.insert(
          `INSERT INTO payments (tenancy_id, amount, method, reference_number, proof, paid_on, note, status,
             recorded_by_id, created_at)
           VALUES (?, ?, 'gcash', ?, ?, ?, ?, 'pending', ?, ?)`,
          [tenancy.id, amount, reference, proofPath, date, note, req.user.id, nowIso()],
        );
      } catch (error) {
        await deleteFile(mediaDir, proofPath);
        // The same reference submitted at the same moment by another request.
        if (isUniqueViolation(error)) throw formErrors({ reference_number: ['This reference number has already been submitted.'] });
        throw error;
      }
      await notify(db, await runnersOfUnit(db, tenancy.unit_id), 'payment',
        `${displayName(tenancy.tenant)} sent a ${peso(amount)} GCash payment for ${tenancy.unit.name}. Check reference ${reference} and confirm it.`,
        '/owner/payments');
      return reply(201, {
        message: `GCash payment of ${peso(amount)} submitted. It will count toward your balance once the owner confirms it.`,
      });
    },
  });

  async function tenantTenancy(req) {
    const [tenancy] = await tenanciesFor(db, { tenantId: req.user.id, id: id(req) });
    if (!tenancy) throw notFound();
    if (!acceptsGcash(tenancy.owner)) {
      throw fail(`${displayName(tenancy.owner)} has not set up GCash yet. Pay them in person, and they will record it here.`);
    }
    return tenancy;
  }

  endpoint(router, '/payments/submissions/:id/cancel/', {
    roles: TENANT,
    POST: async (req) => {
      const payment = await db.get(
        `${PAYMENT_SELECT} WHERE pay.id = ? AND a.tenant_id = ? AND pay.recorded_by_id = ? AND pay.status = 'pending'`,
        [id(req), req.user.id, req.user.id],
      );
      if (!payment) throw notFound();
      const { changes } = await db.run("DELETE FROM payments WHERE id = ? AND status = 'pending'", [payment.id]);
      if (!changes) throw notFound();
      await deleteFile(mediaDir, payment.proof);
      return { message: 'GCash submission cancelled.' };
    },
  });

  // ----------------------------------------------------------------- owner

  endpoint(router, '/owner/payments/', {
    roles: RUNNERS,
    GET: async (req) => {
      const ledgers = await ledgersFor(db, await tenanciesFor(db, { runnerId: req.user.id }));
      ledgers.sort((a, b) => (Number(!a.active) - Number(!b.active))
        || (b.balance - a.balance)
        || a.tenancy.property.name.localeCompare(b.tenancy.property.name)
        || a.tenancy.unit.name.localeCompare(b.tenancy.unit.name));
      const pending = await db.all(
        `${PAYMENT_SELECT} WHERE ${RUNS('p')} AND pay.status = 'pending' ORDER BY pay.created_at, pay.id`,
        [req.user.id, req.user.id],
      );
      return {
        ledgers: ledgers.map(ledgerJson),
        pending: pending.map((p) => paymentJson(p, req.user)),
        outstanding: money(ledgers.reduce((sum, l) => sum + l.balance, 0)),
        // Managers don't receive rent themselves, so they never need to set up GCash.
        gcash_ready: req.user.role === 'manager' || acceptsGcash(req.user),
      };
    },
  });

  async function ownerTenancy(req) {
    const [tenancy] = await tenanciesFor(db, { runnerId: req.user.id, id: id(req) });
    if (!tenancy) throw notFound();
    return tenancy;
  }

  endpoint(router, '/owner/payments/tenancy/:id/', {
    roles: RUNNERS,
    GET: async (req) => {
      const tenancy = await ownerTenancy(req);
      const history = await db.all(`${PAYMENT_SELECT} WHERE pay.tenancy_id = ? ${PAYMENT_ORDER}`, [tenancy.id]);
      return {
        ledger: ledgerJson(await ledgerFor(db, tenancy)),
        history: history.map((p) => paymentJson(p, req.user)),
        today: today(),
      };
    },
    // Record money received in person, upfront, or any other way. Counts immediately.
    POST: async (req) => {
      const tenancy = await ownerTenancy(req);
      const form = new Form(req.body);
      const amount = form.money('amount', { min: 1 });
      const method = form.choice('method', PAYMENT_METHODS);
      const kind = form.has('kind') ? form.choice('kind', PAYMENT_KINDS) : 'monthly';
      const date = paidOn(form);
      const reference = form.text('reference_number', { required: false, max: 20 });
      const note = form.text('note', { required: false, max: 255 });
      const duplicate = 'This GCash reference number is already recorded.';
      if (method === 'gcash' && reference && form.ok('reference_number') && await referenceInUse(db, reference)) {
        form.error('reference_number', duplicate);
      }
      form.check();
      const now = nowIso();
      try {
        await db.insert(
          `INSERT INTO payments (tenancy_id, amount, method, reference_number, paid_on, note, status, recorded_by_id,
             reviewed_at, created_at, kind)
           VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)`,
          [tenancy.id, amount, method, reference, date, note, req.user.id, now, now, kind],
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw formErrors({ reference_number: [duplicate] });
        throw error;
      }
      const after = await ledgerFor(db, tenancy);
      let status = 'Fully paid.';
      if (after.balance) status = `${peso(after.balance)} still owed.`;
      else if (after.credit) status = `Fully paid, with ${peso(after.credit)} credit for future months.`;
      await notify(db, tenancy.tenant_id, 'payment',
        `A ${peso(amount)} payment for ${tenancy.property.name} ${tenancy.unit.name} was recorded. ${status}`, '/payments');
      return reply(201, { message: `Recorded ${peso(amount)} from ${displayName(tenancy.tenant)}. ${status}` });
    },
  });

  endpoint(router, '/owner/payments/:id/:decision/', {
    roles: RUNNERS,
    POST: async (req) => {
      const { decision } = req.params;
      // Which status a payment must have for each action.
      const allowed = { confirm: 'pending', reject: 'pending', void: 'confirmed' }[decision];
      if (!allowed) throw notFound();
      const payment = await db.get(`${PAYMENT_SELECT} WHERE pay.id = ? AND ${RUNS('p')}`, [id(req), req.user.id, req.user.id]);
      if (!payment) throw notFound();
      const tenant = displayName(person(payment, 't', payment.tenant_id));
      const handled = () => fail('That payment has already been handled.');
      if (payment.status !== allowed) throw handled();

      let status;
      let ownerNote = payment.owner_note;
      let message;
      if (decision === 'confirm') {
        status = 'confirmed';
        message = `Confirmed ${peso(payment.amount)} GCash payment from ${tenant}.`;
      } else {
        const reasonValue = req.body?.reason;
        const reason = typeof reasonValue === 'string' && reasonValue.length <= 255 ? reasonValue.trim() : '';
        status = 'rejected';
        ownerNote = reason || (decision === 'void' ? VOIDED : '');
        const verb = decision === 'void' ? 'Voided' : 'Rejected';
        message = `${verb} ${peso(payment.amount)} payment from ${tenant}. It no longer counts toward the balance.`;
      }
      // Only applies if nobody handled the payment in the meantime.
      const { changes } = await db.run(
        'UPDATE payments SET status = ?, reviewed_at = ?, owner_note = ? WHERE id = ? AND status = ?',
        [status, nowIso(), ownerNote, payment.id, allowed],
      );
      if (!changes) throw handled();
      const where = `${payment.property_name} ${payment.unit_name}`;
      const tenantMessage = {
        confirm: `Your ${peso(payment.amount)} GCash payment for ${where} was confirmed.`,
        reject: `Your ${peso(payment.amount)} payment for ${where} was rejected${ownerNote ? `: ${ownerNote}` : '.'}`,
        void: `A ${peso(payment.amount)} payment for ${where} was voided and no longer counts toward your balance.`,
      }[decision];
      await notify(db, payment.tenant_id, 'payment', tenantMessage, '/payments');
      return { message };
    },
  });

  return router;
}
