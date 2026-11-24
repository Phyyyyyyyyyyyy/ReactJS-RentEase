/** Formatting helpers for dates and money from the API. */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];

const manila = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
});

function dateParts(value) {
  if (!value) return null;
  // Plain dates (YYYY-MM-DD) have no time zone: use the numbers as they are.
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (plain) return { y: +plain[1], m: +plain[2], d: +plain[3], h: 0, min: 0 };
  // Date-times are shown in Manila time, like the server does.
  const p = Object.fromEntries(manila.formatToParts(new Date(value)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute };
}

/**
 * Format a date with PHP-style tokens: F (January), M (Jan), j (5), Y (2026),
 * g (3), i (07), A (PM). Example: formatDate('2026-11-24', 'M j, Y') -> "Nov 24, 2026".
 */
export function formatDate(value, format) {
  const p = dateParts(value);
  if (!p) return '';
  const tokens = {
    F: MONTHS[p.m - 1],
    M: MONTHS[p.m - 1].slice(0, 3),
    j: p.d,
    Y: p.y,
    g: p.h % 12 || 12,
    i: String(p.min).padStart(2, '0'),
    A: p.h < 12 ? 'AM' : 'PM',
  };
  return format.replace(/[FMjYgiA]/g, (t) => tokens[t]);
}

/** Philippine pesos: whole amounts stay short (₱8,500); partial ones keep centavos (₱1,250.50). */
export function peso(value) {
  const number = Number(value);
  if (value === null || value === undefined || value === '' || Number.isNaN(number)) return '—';
  const whole = Number.isInteger(number);
  return `₱${number.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

/** True when a money string from the API is above zero. */
export function positive(value) {
  return Number(value) > 0;
}

export function plural(count, singular = '', pluralSuffix = 's') {
  return Number(count) === 1 ? singular : pluralSuffix;
}

export function todayInManila() {
  const p = dateParts(new Date().toISOString());
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** "2 bedrooms · 1 bath · 28 sqm" */
export function unitSummary(unit) {
  const beds = unit.bedrooms ? `${unit.bedrooms} bedroom${plural(unit.bedrooms)}` : 'Studio';
  const area = unit.floor_area ? ` · ${unit.floor_area} sqm` : '';
  return `${beds} · ${unit.bathrooms} bath${plural(unit.bathrooms)}${area}`;
}
