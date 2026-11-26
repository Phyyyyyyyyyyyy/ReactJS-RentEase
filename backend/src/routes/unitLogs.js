/**
 * Payment logs: the owner's own record of a unit's payments, kept like a
 * spreadsheet (date, description, amount, mode). Meant for buyers or tenants who
 * don't use the app, e.g. a rent-to-own contract from before RentEase. A unit can
 * have several logs (one per buyer/contract). Entries can be typed in or imported
 * from the spreadsheet saved as CSV.
 *
 * The property's owner and its manager can see and change its logs; nobody else.
 */
import { Router } from 'express';
import { readLogCsv } from '../csvImport.js';
import { Form } from '../lib/forms.js';
import { endpoint, fail, notFound, reply } from '../lib/http.js';
import { iso, money, nowIso, peso, today } from '../lib/format.js';
import { displayName } from '../users.js';
import { RUNNERS, RUNS } from './properties.js';

const MAX_IMPORT_ROWS = 2000;

/** One CSV cell; text starting with = + - @ is prefixed so spreadsheets don't run it as a formula. */
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const percent = (bp) => (bp === null || bp === undefined ? null : money(bp));

function logJson(log, totals) {
  const contract = log.contract_price;
  return {
    id: log.id,
    unit_id: log.unit_id,
    holder_name: log.holder_name,
    start_date: log.start_date,
    contract_price: money(contract),
    term_years: log.term_years,
    interest_rate: percent(log.interest_rate_bp),
    monthly_amount: money(log.monthly_amount),
    note: log.note,
    created_at: iso(log.created_at),
    created_by: log.creator_username
      ? displayName({ username: log.creator_username, first_name: log.creator_first_name, last_name: log.creator_last_name }) : null,
    entries_count: Number(totals.n || 0),
    total_paid: money(Number(totals.total || 0)),
    remaining_balance: contract ? money(Math.max(contract - Number(totals.total || 0), 0)) : null,
    percent_paid: contract ? Math.min(100, Math.round((Number(totals.total || 0) / contract) * 1000) / 10) : null,
    last_entry_date: totals.last || null,
  };
}

const entryJson = (e) => ({
  id: e.id, entry_date: e.entry_date, description: e.description, amount: money(e.amount), mode: e.mode,
  reference: e.reference, note: e.note,
});

/** Validate an entry's fields (shared by add and edit). */
function cleanEntry(body) {
  const form = new Form(body);
  const values = {
    entry_date: form.date('entry_date'),
    description: form.text('description', { required: false, max: 100 }),
    amount: form.money('amount', { min: 0.01 }),
    mode: form.text('mode', { required: false, max: 100 }),
    reference: form.text('reference', { required: false, max: 50 }),
    note: form.text('note', { required: false, max: 255 }),
  };
  if (values.amount !== null && form.ok('amount') && values.amount <= 0) form.error('amount', 'The amount must be greater than zero.');
  form.check();
  return values;
}

/** Validate a log's header fields; defaults come from the unit. */
function cleanLog(body, unit) {
  const form = new Form(body);
  const values = {
    holder_name: form.text('holder_name', { max: 200 }),
    start_date: form.date('start_date', { required: false }),
    contract_price: form.has('contract_price') ? form.money('contract_price', { required: false, min: 1 }) : unit?.contract_price ?? null,
    term_years: form.has('term_years') ? form.integer('term_years', { required: false, min: 1, max: 50 }) : unit?.term_years ?? null,
    interest_rate_bp: form.has('interest_rate') ? form.money('interest_rate', { required: false, min: 0 }) : unit?.interest_rate_bp ?? null,
    monthly_amount: form.has('monthly_amount') ? form.money('monthly_amount', { required: false, min: 1 }) : unit?.monthly_rent ?? null,
    note: form.text('note', { required: false, max: 500 }),
  };
  if (values.interest_rate_bp !== null && form.ok('interest_rate') && values.interest_rate_bp > 10000) {
    form.error('interest_rate', 'Ensure this value is less than or equal to 100.');
  }
  form.check();
  return values;
}

export default function unitLogsRoutes(db) {
  const router = Router();

  const positiveId = (value) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n <= 0) throw notFound();
    return n;
  };

  /** A unit on a property the user owns or manages. */
  async function runUnit(req) {
    const unit = await db.get(
      `SELECT u.*, p.name AS property_name, p.address AS property_address, p.city AS property_city
       FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ? AND ${RUNS('p')}`,
      [positiveId(req.params.id), req.user.id, req.user.id]);
    if (!unit) throw notFound();
    return unit;
  }

  const LOG_SELECT = `
    SELECT l.*, c.username AS creator_username, c.first_name AS creator_first_name, c.last_name AS creator_last_name,
      u.name AS unit_name, u.property_id, p.name AS property_name, p.address AS property_address, p.city AS property_city
    FROM unit_logs l JOIN units u ON u.id = l.unit_id JOIN properties p ON p.id = u.property_id
    LEFT JOIN users c ON c.id = l.created_by_id`;

  const totalsFor = (logId) => db.get(
    'SELECT COUNT(*) AS n, SUM(amount) AS total, MAX(entry_date) AS last FROM unit_log_entries WHERE log_id = ?', [logId]);

  /** A log on a unit the user runs. */
  async function runLog(req, idParam = 'id') {
    const log = await db.get(`${LOG_SELECT} WHERE l.id = ? AND ${RUNS('p')}`,
      [positiveId(req.params[idParam]), req.user.id, req.user.id]);
    if (!log) throw notFound();
    return log;
  }

  async function fullLog(log) {
    const entries = await db.all('SELECT * FROM unit_log_entries WHERE log_id = ? ORDER BY entry_date, id', [log.id]);
    return {
      log: logJson(log, await totalsFor(log.id)),
      unit: { id: log.unit_id, name: log.unit_name },
      property: { id: log.property_id, name: log.property_name, address: log.property_address, city: log.property_city },
      entries: entries.map(entryJson),
      as_of: today(),
    };
  }

  endpoint(router, '/owner/units/:id/logs/', {
    roles: RUNNERS,
    GET: async (req) => {
      const unit = await runUnit(req);
      const logs = await db.all(`${LOG_SELECT} WHERE l.unit_id = ? ORDER BY l.created_at DESC, l.id DESC`, [unit.id]);
      return {
        unit: { id: unit.id, name: unit.name, listing_type: unit.listing_type || 'rent' },
        property: { id: unit.property_id, name: unit.property_name },
        logs: await Promise.all(logs.map(async (l) => logJson(l, await totalsFor(l.id)))),
      };
    },
    POST: async (req) => {
      const unit = await runUnit(req);
      const v = cleanLog(req.body, unit);
      const id = await db.insert(
        `INSERT INTO unit_logs (unit_id, holder_name, start_date, contract_price, term_years, interest_rate_bp, monthly_amount,
           note, created_by_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [unit.id, v.holder_name, v.start_date, v.contract_price, v.term_years, v.interest_rate_bp, v.monthly_amount, v.note,
          req.user.id, nowIso()],
      );
      return reply(201, { id, message: `Payment log for ${v.holder_name} created.` });
    },
  });

  endpoint(router, '/owner/logs/:id/', {
    roles: RUNNERS,
    GET: async (req) => fullLog(await runLog(req)),
    PUT: async (req) => {
      const log = await runLog(req);
      const v = cleanLog(req.body, log);
      await db.run(
        `UPDATE unit_logs SET holder_name = ?, start_date = ?, contract_price = ?, term_years = ?, interest_rate_bp = ?,
           monthly_amount = ?, note = ? WHERE id = ?`,
        [v.holder_name, v.start_date, v.contract_price, v.term_years, v.interest_rate_bp, v.monthly_amount, v.note, log.id],
      );
      return { message: 'Payment log updated.' };
    },
    DELETE: async (req) => {
      const log = await runLog(req);
      await db.run('DELETE FROM unit_logs WHERE id = ?', [log.id]); // its entries go too
      return { message: `Payment log for ${log.holder_name} deleted.`, unit_id: log.unit_id };
    },
  });

  endpoint(router, '/owner/logs/:id/entries/', {
    roles: RUNNERS,
    POST: async (req) => {
      const log = await runLog(req);
      const v = cleanEntry(req.body);
      await db.insert(
        `INSERT INTO unit_log_entries (log_id, entry_date, description, amount, mode, reference, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [log.id, v.entry_date, v.description, v.amount, v.mode, v.reference, v.note, nowIso()],
      );
      return reply(201, { message: `Added ${peso(v.amount)} on ${v.entry_date}.` });
    },
  });

  /** An entry in a log the user runs. */
  async function runEntry(req) {
    const entry = await db.get(
      `SELECT e.* FROM unit_log_entries e JOIN unit_logs l ON l.id = e.log_id JOIN units u ON u.id = l.unit_id
       JOIN properties p ON p.id = u.property_id WHERE e.id = ? AND ${RUNS('p')}`,
      [positiveId(req.params.id), req.user.id, req.user.id]);
    if (!entry) throw notFound();
    return entry;
  }

  endpoint(router, '/owner/log-entries/:id/', {
    roles: RUNNERS,
    PUT: async (req) => {
      const entry = await runEntry(req);
      const v = cleanEntry(req.body);
      await db.run(
        'UPDATE unit_log_entries SET entry_date = ?, description = ?, amount = ?, mode = ?, reference = ?, note = ? WHERE id = ?',
        [v.entry_date, v.description, v.amount, v.mode, v.reference, v.note, entry.id],
      );
      return { message: 'Entry updated.' };
    },
    DELETE: async (req) => {
      const entry = await runEntry(req);
      await db.run('DELETE FROM unit_log_entries WHERE id = ?', [entry.id]);
      return { message: `Removed ${peso(entry.amount)} on ${entry.entry_date}.` };
    },
  });

  // Import entries from a spreadsheet saved as CSV. With preview: true nothing is
  // saved; the answer lists what would be added, what's already there, and rows it couldn't read.
  endpoint(router, '/owner/logs/:id/import/', {
    roles: RUNNERS,
    POST: async (req) => {
      const log = await runLog(req);
      const text = typeof req.body.csv === 'string' ? req.body.csv : '';
      if (!text.trim()) throw fail('Choose a CSV file to import (in Excel: File → Save As → CSV).');
      const { entries, skipped } = readLogCsv(text);
      if (entries.length > MAX_IMPORT_ROWS) throw fail(`That file has more than ${MAX_IMPORT_ROWS} payments. Split it into smaller files.`);
      // Entries already in the log (same date, amount, and description) are skipped, so importing twice is harmless.
      const existing = new Set((await db.all('SELECT entry_date, amount, description FROM unit_log_entries WHERE log_id = ?', [log.id]))
        .map((e) => `${e.entry_date}|${e.amount}|${e.description.toLowerCase()}`));
      const rows = entries.map((e) => {
        const key = `${e.entry_date}|${e.amount}|${e.description.toLowerCase()}`;
        const duplicate = existing.has(key);
        existing.add(key);
        return { ...e, duplicate };
      });
      const toAdd = rows.filter((r) => !r.duplicate);
      const preview = req.body.preview === true || req.body.preview === 'true';
      if (!preview && toAdd.length) {
        const now = nowIso();
        await db.tx(async (t) => {
          for (const r of toAdd) {
            await t.insert(
              `INSERT INTO unit_log_entries (log_id, entry_date, description, amount, mode, reference, note, created_at)
               VALUES (?, ?, ?, ?, ?, '', '', ?)`,
              [log.id, r.entry_date, r.description, r.amount, r.mode, now]);
          }
        });
      }
      return {
        preview,
        rows: rows.map((r) => ({ ...r, amount: money(r.amount) })),
        skipped,
        added: preview ? 0 : toAdd.length,
        total: money(toAdd.reduce((s, r) => s + r.amount, 0)),
        message: preview
          ? `${toAdd.length} payment${toAdd.length === 1 ? '' : 's'} ready to import (${peso(toAdd.reduce((s, r) => s + r.amount, 0))}).`
          : `Imported ${toAdd.length} payment${toAdd.length === 1 ? '' : 's'}${rows.length - toAdd.length ? `; skipped ${rows.length - toAdd.length} already in the log` : ''}.`,
      };
    },
  });

  endpoint(router, '/owner/logs/:id/export/', {
    roles: RUNNERS,
    GET: async (req, res) => {
      const { log, unit, property, entries, as_of: asOf } = await fullLog(await runLog(req));
      const lines = [
        ['Statement of Account'],
        [],
        ['Date', `As of ${asOf}`],
        ['To', log.holder_name],
        ['Re', `${unit.name}, ${property.name}, ${property.address}, ${property.city}`],
        ...(log.term_years ? [['Term', `${log.term_years} yrs`]] : []),
        ...(log.contract_price ? [['Contract price (PHP)', log.contract_price]] : []),
        ...(log.interest_rate !== null ? [['Interest rate', `${log.interest_rate}% per annum`]] : []),
        [],
        ['Payments', 'Date', 'Amount (PHP)', 'Mode of payment', 'Reference', 'Note'],
        ...entries.map((e) => [e.description, e.entry_date, e.amount, e.mode, e.reference, e.note]),
        [],
        ['Total paid (PHP)', '', log.total_paid],
        ...(log.remaining_balance !== null ? [['Remaining balance (PHP)', '', log.remaining_balance]] : []),
      ];
      const csv = `﻿${lines.map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
      const safeName = `${unit.name}-${log.holder_name}`.replace(/[^\w-]+/g, '-').slice(0, 60);
      res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="payment-log-${safeName}-${asOf}.csv"`,
      }).send(csv);
    },
  });

  return router;
}
