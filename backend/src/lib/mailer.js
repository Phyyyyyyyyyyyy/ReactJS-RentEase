/**
 * Sending email.
 *
 * With RESEND_API_KEY set, emails go out through Resend's HTTPS API (no SMTP,
 * so hosts that block mail ports don't matter). Without it, each email is
 * printed in the server log instead, which is enough to test locally.
 *
 *   await mailer.send({ to, subject, text, html })
 */
import { config } from '../config.js';

export function resendMailer({ apiKey = config.resendApiKey, from = config.emailFrom } = {}) {
  return {
    async send({ to, subject, text, html }) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text, html }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        let detail = '';
        try {
          detail = (await response.json()).message || '';
        } catch {
          // no JSON body
        }
        throw new Error(`Resend refused the email (HTTP ${response.status}). ${detail}`.trim());
      }
    },
  };
}

export function consoleMailer() {
  return {
    async send({ to, subject, text }) {
      console.log(`\n----- Email (not sent: RESEND_API_KEY is not set) -----\nTo: ${to}\nSubject: ${subject}\n\n${text}\n-------------------------------------------------------\n`);
    },
  };
}

export function defaultMailer() {
  return config.resendApiKey ? resendMailer() : consoleMailer();
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Make text safe to put inside an email's HTML (names can contain anything). */
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
