import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { brevoMailer, mailjetMailer, parseAddress, resendMailer } from '../src/lib/mailer.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** Replace fetch with a fake that records the request and answers with `status` and `body`. */
function fakeFetch(status, body) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, json: JSON.parse(options.body) });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return calls;
}

const email = { to: 'juan@example.com', subject: 'Verify', text: 'Open the link', html: '<p>Open the link</p>' };

describe('mailer', () => {
  it('reads "Name <address>" sender strings', () => {
    assert.deepEqual(parseAddress('RentEase <me@gmail.com>'), { name: 'RentEase', email: 'me@gmail.com' });
    assert.deepEqual(parseAddress('"Rent Ease" <me@gmail.com>'), { name: 'Rent Ease', email: 'me@gmail.com' });
    assert.deepEqual(parseAddress('me@gmail.com'), { email: 'me@gmail.com' });
  });

  it('sends through Brevo’s API', async () => {
    const calls = fakeFetch(201, { messageId: '<abc@brevo>' });
    await brevoMailer({ apiKey: 'xkeysib-test', from: 'RentEase <me@gmail.com>' }).send(email);
    assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(calls[0].options.headers['api-key'], 'xkeysib-test');
    assert.deepEqual(calls[0].json, {
      sender: { name: 'RentEase', email: 'me@gmail.com' },
      to: [{ email: 'juan@example.com' }],
      subject: 'Verify',
      textContent: 'Open the link',
      htmlContent: '<p>Open the link</p>',
    });
  });

  it('reports Brevo’s reason when it refuses', async () => {
    fakeFetch(400, { code: 'invalid_parameter', message: 'Sender is not valid' });
    await assert.rejects(brevoMailer({ apiKey: 'k', from: 'x@y.z' }).send(email), /Brevo refused the email \(HTTP 400\)\. Sender is not valid/);
  });

  it('sends through Mailjet’s API', async () => {
    const calls = fakeFetch(200, { Messages: [{ Status: 'success' }] });
    await mailjetMailer({ apiKey: 'pub', secretKey: 'priv', from: 'RentEase <me@gmail.com>' }).send(email);
    assert.equal(calls[0].url, 'https://api.mailjet.com/v3.1/send');
    assert.equal(calls[0].options.headers.Authorization, `Basic ${Buffer.from('pub:priv').toString('base64')}`);
    assert.deepEqual(calls[0].json, {
      Messages: [{
        From: { Email: 'me@gmail.com', Name: 'RentEase' },
        To: [{ Email: 'juan@example.com' }],
        Subject: 'Verify',
        TextPart: 'Open the link',
        HTMLPart: '<p>Open the link</p>',
      }],
    });
  });

  it('reports Mailjet’s reason when it refuses', async () => {
    fakeFetch(400, { Messages: [{ Status: 'error', Errors: [{ ErrorMessage: 'The sender is not validated' }] }] });
    await assert.rejects(mailjetMailer({ apiKey: 'a', secretKey: 'b', from: 'x@y.z' }).send(email),
      /Mailjet refused the email \(HTTP 400\)\. The sender is not validated/);
    fakeFetch(401, { ErrorMessage: 'API key authentication/authorization failure' });
    await assert.rejects(mailjetMailer({ apiKey: 'a', secretKey: 'b', from: 'x@y.z' }).send(email), /HTTP 401\)\. API key/);
  });

  it('still supports Resend', async () => {
    const calls = fakeFetch(200, { id: '1' });
    await resendMailer({ apiKey: 're_test', from: 'RentEase <onboarding@resend.dev>' }).send(email);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.deepEqual(calls[0].json.to, ['juan@example.com']);
  });
});
