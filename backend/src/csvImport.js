/**
 * Reading a payment log saved from Excel as CSV.
 *
 * Spreadsheets differ, so instead of fixed columns each row is read like a
 * person would: the first cell that is a date is the date, the next cell that is
 * an amount is the amount, the text before the date is the description, and the
 * text after the amount is the mode of payment. Rows without both a date and an
 * amount (titles, headers, totals) are skipped.
 */

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

/** Split CSV text into rows of cells (handles quotes, "" escapes, and CRLF). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(text).replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const pad = (n) => String(n).padStart(2, '0');

function validDate(y, m, d) {
  if (y < 100) y += 2000;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1950 && y <= 2100)) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  const check = new Date(`${iso}T00:00:00Z`);
  return check.toISOString().slice(0, 10) === iso ? iso : null;
}

/** "Oct 31, 2019", "May 05,2021", "April 05, 2024", "2019-10-31", "10/31/2019", "31-Oct-19" -> "2019-10-31" (or null). */
export function parseDate(text) {
  const s = String(text || '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = /^([A-Za-z]+)\.? (\d{1,2}),? ?(\d{2,4})$/.exec(s) || /^([A-Za-z]+)\.? ?(\d{1,2}), ?(\d{2,4})$/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return validDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = /^(\d{1,2})[- ]([A-Za-z]+)\.?[- ,]+(\d{2,4})$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return validDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s); // month/day/year, as Excel writes it
  if (m) return validDate(+m[3], +m[1], +m[2]);
  return null;
}

/** "20,000", "₱ 20,000.00", "PHP 60000" -> centavos (or null). */
export function parseAmount(text) {
  const s = String(text || '').trim().replace(/^(₱|PHP|PH|P)\s*/i, '').replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, fraction = ''] = s.split('.');
  if (whole.length > 10) return null;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return cents > 0 ? cents : null;
}

/**
 * Read log entries from CSV text. Returns { entries, skipped }: entries have
 * { line, entry_date, amount, description, mode }; skipped lists rows that had
 * some content but no date or amount, so the preview can show them.
 */
export function readLogCsv(text) {
  const entries = [];
  const skipped = [];
  parseCsv(text).forEach((cells, index) => {
    const line = index + 1;
    const trimmed = cells.map((c) => c.trim());
    if (!trimmed.some(Boolean)) return;
    const dateAt = trimmed.findIndex((c) => parseDate(c));
    const amountAt = dateAt < 0 ? -1 : trimmed.findIndex((c, i) => i > dateAt && parseAmount(c) !== null);
    if (dateAt < 0 || amountAt < 0) {
      skipped.push({ line, text: trimmed.filter(Boolean).join(' · ').slice(0, 120) });
      return;
    }
    entries.push({
      line,
      entry_date: parseDate(trimmed[dateAt]),
      amount: parseAmount(trimmed[amountAt]),
      description: trimmed.slice(0, dateAt).filter(Boolean).join(' ').slice(0, 100),
      mode: trimmed.slice(amountAt + 1).filter(Boolean).join(' ').slice(0, 100),
    });
  });
  return { entries, skipped };
}
