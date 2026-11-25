/**
 * Referral codes: signing up needs one. An admin creates each code for one role
 * (Property Owner, Tenant, or Property Manager); the new account gets that role.
 * A code works any number of times until an admin disables it.
 */
import { randomInt } from 'node:crypto';
import { iso } from './lib/format.js';
import { displayName, ROLE_LABEL } from './users.js';

// No 0/O or 1/I/L, so codes are easy to read out and type.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CUSTOM_CODE_RE = /^[A-Z0-9-]{4,32}$/;

/** A random code like "K7QX-M2PA" (31^8 ≈ 850 billion possibilities, so it can't be guessed). */
export function generateCode() {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${part()}-${part()}`;
}

export const normalizeCode = (text) => String(text || '').trim().toUpperCase();

/** The active referral code matching `text` (any letter case), or null. */
export async function findReferralCode(db, text) {
  const code = normalizeCode(text);
  if (!code) return null;
  return (await db.get('SELECT * FROM referral_codes WHERE UPPER(code) = ? AND is_active = 1', [code])) || null;
}

export function referralJson(r) {
  return {
    id: r.id,
    code: r.code,
    role: r.role,
    role_display: ROLE_LABEL[r.role],
    label: r.label,
    is_active: Boolean(r.is_active),
    uses: Number(r.uses ?? 0),
    created_by: r.creator_username ? displayName({ username: r.creator_username, first_name: r.creator_first_name, last_name: r.creator_last_name }) : null,
    created_at: iso(r.created_at),
  };
}
