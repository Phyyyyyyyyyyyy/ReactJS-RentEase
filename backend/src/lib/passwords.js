/**
 * Password hashing and password rules.
 *
 * Hashes use PBKDF2-SHA256 in the same text format Django uses
 * ("pbkdf2_sha256$<iterations>$<salt>$<hash>"), so passwords are never stored
 * in plain text and accounts created by the old Django version still work.
 */
import { pbkdf2, randomInt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2Async = promisify(pbkdf2);
const SALT_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// Tests set PASSWORD_ITERATIONS low so they run fast.
const iterations = () => Number(process.env.PASSWORD_ITERATIONS) || 600_000;

async function derive(password, salt, rounds) {
  return (await pbkdf2Async(password, salt, rounds, 32, 'sha256')).toString('base64');
}

export async function hashPassword(password) {
  const salt = Array.from({ length: 22 }, () => SALT_CHARS[randomInt(SALT_CHARS.length)]).join('');
  const rounds = iterations();
  return `pbkdf2_sha256$${rounds}$${salt}$${await derive(password, salt, rounds)}`;
}

export async function checkPassword(password, encoded) {
  const [algorithm, rounds, salt, hash] = String(encoded || '').split('$');
  if (algorithm !== 'pbkdf2_sha256' || !hash) return false;
  const actual = Buffer.from(await derive(password, salt, Number(rounds)));
  const expected = Buffer.from(hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// A short list of the most common passwords (Django's own list is much longer).
const COMMON_PASSWORDS = new Set(`
123456 password 12345678 qwerty 123456789 12345 1234 111111 1234567 dragon 123123 baseball abc123 football
monkey letmein shadow master 696969 mustang michael pussy superman 1234567890 password1 password123
iloveyou trustno1 sunshine princess welcome admin admin123 qwerty123 qwertyuiop passw0rd starwars
whatever freedom hello charlie donald login solo jordan23 batman access flower 654321 555555 7777777
888888 000000 121212 aa123456 1q2w3e4r 1qaz2wsx zaq12wsx asdfghjk asdfgh zxcvbnm computer internet
michelle jessica ashley daniel hunter killer ranger thomas tigger soccer hockey cheese summer
secret secret123 changeme default guest test test123 testing root toor pass pass123 qwe123 abcd1234
abcdef abcdefg lovely loveme iloveu angel angels babygirl blessed jesus pokemon naruto minecraft
manila philippines pilipinas mahalkita iloveyou1 rentease rentease123 welcome1 welcome123 letmein1
`.trim().split(/\s+/));

function quickRatio(a, b) {
  // Share of characters the two strings have in common (Python difflib's quick_ratio).
  const counts = new Map();
  for (const ch of b) counts.set(ch, (counts.get(ch) || 0) + 1);
  let matches = 0;
  for (const ch of a) {
    const n = counts.get(ch) || 0;
    if (n > 0) {
      matches += 1;
      counts.set(ch, n - 1);
    }
  }
  return a.length + b.length ? (2 * matches) / (a.length + b.length) : 1;
}

const SIMILAR_ATTRIBUTES = [['username', 'username'], ['first_name', 'first name'], ['last_name', 'last name'],
  ['email', 'email address']];

/** The reasons `password` is too weak (an empty list means it is fine). */
export function passwordProblems(password, user = {}) {
  const problems = [];
  const lower = password.toLowerCase();
  for (const [field, label] of SIMILAR_ATTRIBUTES) {
    const value = String(user[field] || '').toLowerCase();
    if (!value) continue;
    const parts = [value, ...value.split(/\W+/)];
    const similar = parts.some((part) => {
      if (!part) return false;
      // Very short parts of a long password don't count.
      if (lower.length >= 10 * part.length && part.length < 0.35 * lower.length) return false;
      return quickRatio(lower, part) >= 0.7;
    });
    if (similar) {
      problems.push(`The password is too similar to the ${label}.`);
      break;
    }
  }
  if (password.length < 8) problems.push('This password is too short. It must contain at least 8 characters.');
  if (COMMON_PASSWORDS.has(lower.trim())) problems.push('This password is too common.');
  if (/^\d+$/.test(password)) problems.push('This password is entirely numeric.');
  return problems;
}
