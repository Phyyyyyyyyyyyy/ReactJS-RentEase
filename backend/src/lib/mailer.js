/**
 * Sending email, through whichever service is set up (first match wins):
 *
 *   MAILJET_API_KEY + MAILJET_SECRET_KEY -> Mailjet (https://mailjet.com). Emails
 *                      anyone from a sender address you verified in Mailjet; no
 *                      domain needed. Set EMAIL_FROM to that address.
 *   BREVO_API_KEY   -> Brevo (https://brevo.com). Emails anyone from a sender
 *                      address you verified in Brevo; no domain needed. Set
 *                      EMAIL_FROM to that address.
 *   RESEND_API_KEY  -> Resend (https://resend.com). Emails anyone only from a
 *                      verified domain; its test sender only reaches your own inbox.
 *   neither         -> emails are printed in the server log (fine for local testing).
 *
 * Both services are used over HTTPS (no SMTP), so hosts that block mail ports
 * (like Render's free plan) don't matter.
 *
 *   await mailer.send({ to, subject, text, html })
 */
import { config } from '../config.js';

/** "RentEase <me@gmail.com>" -> { name: 'RentEase', email: 'me@gmail.com' } */
export function parseAddress(address) {
  const match = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(address || '');
  if (match) return { name: match[1].replace(/^"|"$/g, '') || undefined, email: match[2] };
  return { email: String(address || '').trim() };
}

async function failure(service, response) {
  let detail = '';
  try {
    detail = (await response.json()).message || '';
  } catch {
    // no JSON body
  }
  return new Error(`${service} refused the email (HTTP ${response.status}). ${detail}`.trim());
}

export function mailjetMailer({ apiKey = config.mailjetApiKey, secretKey = config.mailjetSecretKey, from = config.emailFrom } = {}) {
  const sender = parseAddress(from);
  const auth = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
  return {
    service: 'Mailjet',
    async send({ to, subject, text, html }) {
      const response = await fetch('https://api.mailjet.com/v3.1/send', {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Messages: [{
            From: { Email: sender.email, ...(sender.name ? { Name: sender.name } : {}) },
            To: [{ Email: to }],
            Subject: subject,
            TextPart: text,
            HTMLPart: html,
          }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      let body = {};
      try {
        body = await response.json();
      } catch {
        // no JSON body
      }
      const message = body.Messages?.[0];
      if (!response.ok || (message && message.Status !== 'success')) {
        const detail = message?.Errors?.map((e) => e.ErrorMessage).join(' ') || body.ErrorMessage || '';
        throw new Error(`Mailjet refused the email (HTTP ${response.status}). ${detail}`.trim());
      }
    },
  };
}

export function brevoMailer({ apiKey = config.brevoApiKey, from = config.emailFrom } = {}) {
  const sender = parseAddress(from);
  return {
    service: 'Brevo',
    async send({ to, subject, text, html }) {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw await failure('Brevo', response);
    },
  };
}

export function resendMailer({ apiKey = config.resendApiKey, from = config.emailFrom || 'RentEase <onboarding@resend.dev>' } = {}) {
  return {
    service: 'Resend',
    async send({ to, subject, text, html }) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text, html }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw await failure('Resend', response);
    },
  };
}

export function consoleMailer() {
  return {
    service: null,
    async send({ to, subject, text }) {
      console.log(`\n----- Email (not sent: no email service is set up) -----\nTo: ${to}\nSubject: ${subject}\n\n${text}\n--------------------------------------------------------\n`);
    },
  };
}

export function defaultMailer() {
  if (config.mailjetApiKey && config.mailjetSecretKey) return mailjetMailer();
  if (config.brevoApiKey) return brevoMailer();
  if (config.resendApiKey) return resendMailer();
  return consoleMailer();
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Make text safe to put inside an email's HTML (names can contain anything). */
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
