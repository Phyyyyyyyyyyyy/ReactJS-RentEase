/**
 * Email verification.
 *
 * A new account gets an email with a one-time link (valid 24 hours). Until the
 * link is opened, the account can't sign in. The link carries a random token;
 * the database stores only its SHA-256 hash and the email address it was sent
 * to, so a link for an old address can't verify a new one.
 */
import { createHash, randomBytes } from 'node:crypto';
import { escapeHtml } from './lib/mailer.js';
import { nowIso } from './lib/format.js';

const LINK_LIFETIME_MS = 24 * 60 * 60 * 1000;
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

/** Create a new link for `user` (replacing earlier ones) and email it. */
export async function sendVerificationEmail(db, mailer, user, appUrl) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  await db.run('DELETE FROM email_tokens WHERE user_id = ? OR expires_at <= ?', [user.id, new Date(now).toISOString()]);
  await db.run('INSERT INTO email_tokens (id, user_id, email, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    [hashToken(token), user.id, user.email.toLowerCase(), new Date(now + LINK_LIFETIME_MS).toISOString(), nowIso()]);

  const link = `${appUrl}/verify-email?token=${token}`;
  const name = user.first_name || user.username;
  await mailer.send({
    to: user.email,
    subject: 'Verify your RentEase email address',
    text: `Hi ${name},\n\nConfirm your email address to finish setting up your RentEase account:\n\n${link}\n\n`
      + "This link expires in 24 hours. If you didn't create a RentEase account, you can ignore this email.",
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;color:#0f172a">
  <h2 style="color:#2563eb">Verify your email</h2>
  <p>Hi ${escapeHtml(name)},</p>
  <p>Confirm your email address to finish setting up your RentEase account.</p>
  <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Verify email address</a></p>
  <p style="font-size:13px;color:#64748b">Or open this link: ${escapeHtml(link)}</p>
  <p style="font-size:13px;color:#64748b">This link expires in 24 hours. If you didn't create a RentEase account, you can ignore this email.</p>
</div>`,
  });
}

/** Mark the account verified if `token` is a valid, unexpired link for its current email. Returns the user or null. */
export async function verifyEmailToken(db, token) {
  if (typeof token !== 'string' || !/^[\w-]{20,100}$/.test(token)) return null;
  return db.tx(async (t) => {
    const row = await t.get(
      `SELECT u.*, e.email AS token_email FROM email_tokens e JOIN users u ON u.id = e.user_id
       WHERE e.id = ? AND e.expires_at > ?`,
      [hashToken(token), nowIso()],
    );
    if (!row || row.token_email !== row.email.toLowerCase()) return null;
    await t.run('UPDATE users SET email_verified_at = ? WHERE id = ?', [nowIso(), row.id]);
    await t.run('DELETE FROM email_tokens WHERE user_id = ?', [row.id]); // each link works once
    return row;
  });
}

