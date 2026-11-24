/**
 * Expenses and financial reports, for property owners.
 *
 * Income is rent actually received: confirmed payments, by the date they were
 * paid. Expenses are what the owner recorded for each property. Net = income -
 * expenses. Reports cover any date range and can be downloaded as CSV.
 */
import { Router } from 'express';
import { Form } from '../lib/forms.js';
import { endpoint, formErrors, notFound, reply } from '../lib/http.js';
import { iso, isValidDate, money, nowIso, peso, today } from '../lib/format.js';

export const EXPENSE_CATEGORIES = [
  ['maintenance', 'Maintenance'],
  ['repairs', 'Repairs'],
  ['utilities', 'Utilities'],
  ['taxes', 'Taxes & fees'],
  ['insurance', 'Insurance'],
  ['salaries', 'Salaries & services'],
  ['cleaning', 'Cleaning'],
  ['other', 'Other'],
];
const CATEGORY_LABEL = Object.fromEntries(EXPENSE_CATEGORIES);
const OWNER = ['owner'];

function expenseJson(e) {
  return {
    id: e.id,
    property: { id: e.property_id, name: e.property_name },
    category: e.category,
    category_display: CATEGORY_LABEL[e.category],
    amount: money(e.amount),
    spent_on: e.spent_on,
    note: e.note,
    created_at: iso(e.created_at),
  };
}

/** The report's date range from ?start=&end= (default: this month so far). */
function period(query) {
  const day = today();
  const start = isValidDate(String(query.start || '')) ? String(query.start) : `${day.slice(0, 8)}01`;
  const end = isValidDate(String(query.end || '')) ? String(query.end) : day;
  if (start > end) throw formErrors({ end: ['The end date must be on or after the start date.'] });
  return { start, end };
}

/** Income, expenses, and net for the owner's properties between `start` and `end` (inclusive). */
export async function financialReport(db, ownerId, { start, end }) {
  const properties = await db.all('SELECT id, name FROM properties WHERE owner_id = ? ORDER BY name, id', [ownerId]);
  const income = await db.all(
    `SELECT u.property_id, SUM(pay.amount) AS total, COUNT(*) AS n FROM payments pay
     JOIN applications a ON a.id = pay.tenancy_id JOIN units u ON u.id = a.unit_id JOIN properties p ON p.id = u.property_id
     WHERE p.owner_id = ? AND pay.status = 'confirmed' AND pay.paid_on >= ? AND pay.paid_on <= ?
     GROUP BY u.property_id`,
    [ownerId, start, end],
  );
  const expenses = await db.all(
    `SELECT e.property_id, e.category, SUM(e.amount) AS total FROM expenses e JOIN properties p ON p.id = e.property_id
     WHERE p.owner_id = ? AND e.spent_on >= ? AND e.spent_on <= ? GROUP BY e.property_id, e.category`,
    [ownerId, start, end],
  );
  const byProperty = new Map(properties.map((p) => [p.id, { id: p.id, name: p.name, income: 0, payments: 0, expenses: 0 }]));
  for (const row of income) {
    const p = byProperty.get(row.property_id);
    p.income = Number(row.total);
    p.payments = Number(row.n);
  }
  const byCategory = new Map();
  for (const row of expenses) {
    byProperty.get(row.property_id).expenses += Number(row.total);
    byCategory.set(row.category, (byCategory.get(row.category) || 0) + Number(row.total));
  }
  const rows = [...byProperty.values()];
  const totalIncome = rows.reduce((s, r) => s + r.income, 0);
  const totalExpenses = rows.reduce((s, r) => s + r.expenses, 0);
  return {
    start,
    end,
    total_income: totalIncome,
    total_expenses: totalExpenses,
    net: totalIncome - totalExpenses,
    properties: rows.map((r) => ({ ...r, net: r.income - r.expenses })),
    categories: EXPENSE_CATEGORIES.filter(([c]) => byCategory.has(c)).map(([c, label]) => ({ category: c, label, total: byCategory.get(c) })),
  };
}

/** One CSV cell. Cells starting with = + - @ are prefixed so spreadsheet apps don't run them as formulas. */
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function financesRoutes(db) {
  const router = Router();

  endpoint(router, '/owner/expenses/', {
    roles: OWNER,
    GET: async (req) => {
      const { start, end } = period(req.query);
      const params = [req.user.id, start, end];
      let where = 'p.owner_id = ? AND e.spent_on >= ? AND e.spent_on <= ?';
      if (/^\d+$/.test(String(req.query.property || ''))) {
        where += ' AND e.property_id = ?';
        params.push(Number(req.query.property));
      }
      const expenses = await db.all(
        `SELECT e.*, p.name AS property_name FROM expenses e JOIN properties p ON p.id = e.property_id
         WHERE ${where} ORDER BY e.spent_on DESC, e.id DESC`,
        params,
      );
      return {
        start,
        end,
        expenses: expenses.map(expenseJson),
        total: money(expenses.reduce((s, e) => s + e.amount, 0)),
        categories: EXPENSE_CATEGORIES.map(([value, label]) => ({ value, label })),
      };
    },
    POST: async (req) => {
      const form = new Form(req.body);
      const propertyId = form.text('property');
      const category = form.choice('category', EXPENSE_CATEGORIES);
      const amount = form.money('amount', { min: 1 });
      const spentOn = form.date('spent_on');
      const note = form.text('note', { required: false, max: 255 });
      let prop;
      if (propertyId) {
        // Only the owner's own properties can be chosen.
        prop = /^\d+$/.test(propertyId)
          && await db.get('SELECT * FROM properties WHERE id = ? AND owner_id = ?', [Number(propertyId), req.user.id]);
        if (!prop) form.error('property', 'Select a valid choice. That choice is not one of the available choices.');
      }
      if (spentOn && spentOn > today()) form.error('spent_on', 'The expense date cannot be in the future.');
      form.check();
      await db.insert(
        'INSERT INTO expenses (property_id, category, amount, spent_on, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [prop.id, category, amount, spentOn, note, nowIso()],
      );
      return reply(201, { message: `${CATEGORY_LABEL[category]} expense of ${peso(amount)} recorded for ${prop.name}.` });
    },
  });

  endpoint(router, '/owner/expenses/:id/', {
    roles: OWNER,
    DELETE: async (req) => {
      const expenseId = Number(req.params.id);
      const expense = Number.isSafeInteger(expenseId) && await db.get(
        'SELECT e.* FROM expenses e JOIN properties p ON p.id = e.property_id WHERE e.id = ? AND p.owner_id = ?',
        [expenseId, req.user.id]);
      if (!expense) throw notFound();
      await db.run('DELETE FROM expenses WHERE id = ?', [expense.id]);
      return { message: `Expense of ${peso(expense.amount)} deleted.` };
    },
  });

  endpoint(router, '/owner/reports/', {
    roles: OWNER,
    GET: async (req) => {
      const r = await financialReport(db, req.user.id, period(req.query));
      return {
        ...r,
        total_income: money(r.total_income),
        total_expenses: money(r.total_expenses),
        net: money(r.net),
        properties: r.properties.map((p) => ({ ...p, income: money(p.income), expenses: money(p.expenses), net: money(p.net) })),
        categories: r.categories.map((c) => ({ ...c, total: money(c.total) })),
        today: today(),
      };
    },
  });

  endpoint(router, '/owner/reports/export/', {
    roles: OWNER,
    // The report as a CSV file (opens in Excel or Google Sheets).
    GET: async (req, res) => {
      const r = await financialReport(db, req.user.id, period(req.query));
      const expenses = await db.all(
        `SELECT e.*, p.name AS property_name FROM expenses e JOIN properties p ON p.id = e.property_id
         WHERE p.owner_id = ? AND e.spent_on >= ? AND e.spent_on <= ? ORDER BY e.spent_on, e.id`,
        [req.user.id, r.start, r.end],
      );
      const lines = [
        ['RentEase financial report', `${r.start} to ${r.end}`],
        [],
        ['Property', 'Rent received (PHP)', 'Payments', 'Expenses (PHP)', 'Net (PHP)'],
        ...r.properties.map((p) => [p.name, money(p.income), p.payments, money(p.expenses), money(p.net)]),
        ['Total', money(r.total_income), r.properties.reduce((s, p) => s + p.payments, 0), money(r.total_expenses), money(r.net)],
        [],
        ['Expenses'],
        ['Date', 'Property', 'Category', 'Amount (PHP)', 'Note'],
        ...expenses.map((e) => [e.spent_on, e.property_name, CATEGORY_LABEL[e.category], money(e.amount), e.note]),
      ];
      const csv = `﻿${lines.map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
      res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="rentease-report-${r.start}-to-${r.end}.csv"`,
      }).send(csv);
    },
  });

  return router;
}

