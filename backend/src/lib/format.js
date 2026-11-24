/**
 * Dates, times, and money.
 *
 * - Dates are 'YYYY-MM-DD' strings. "Today" is today in Manila.
 * - Timestamps are stored as ISO 8601 UTC ('2026-11-24T13:05:00.000Z') and sent
 *   to the browser in Manila time ('2026-11-24T21:05:00.000+08:00').
 * - Money is whole centavos in the database and in code; it goes out as a
 *   string with two decimals ("8500.00") so no centavos are lost.
 */
import { TIME_ZONE_OFFSET_MS } from '../config.js';

export const nowIso = () => new Date().toISOString();

/** Today's date in Manila, e.g. '2026-11-24'. */
export const today = () => new Date(Date.now() + TIME_ZONE_OFFSET_MS).toISOString().slice(0, 10);

/** The Manila calendar date of a stored UTC timestamp. */
export const localDate = (timestamp) =>
  new Date(Date.parse(timestamp) + TIME_ZONE_OFFSET_MS).toISOString().slice(0, 10);

/** A stored UTC timestamp as ISO 8601 in Manila time; dates pass through unchanged. */
export function iso(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(Date.parse(value) + TIME_ZONE_OFFSET_MS).toISOString().replace('Z', '+08:00');
}

/** Add days to a 'YYYY-MM-DD' date. */
export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Add months to a 'YYYY-MM-DD' date; the day is kept, or clamped to the month's last day (Jan 31 + 1 month = Feb 28). */
export function addMonths(date, months) {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** 850050 centavos -> "8500.50" */
export function money(cents) {
  if (cents === null || cents === undefined) return null;
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** 850050 centavos -> "₱8,500.50", for messages. */
export function peso(cents) {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  return `${cents < 0 ? '-' : ''}₱${whole}.${String(abs % 100).padStart(2, '0')}`;
}
