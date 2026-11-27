/**
 * Online GCash payments, through one of two gateways with the same shape:
 *
 *   createCheckout({ amount, reference, returnUrl }) -> { providerId, url }
 *   retrieveCheckout(providerId)                     -> { paid, paymentId, amount }
 *   verifyWebhook(rawBody, signatureHeader)          -> boolean
 *
 *   SandboxGCashGateway  practice checkout inside RentEase; no real money moves.
 *                        Used when PAYMONGO_SECRET_KEY is not set (and in tests).
 *   PayMongoGateway      real GCash payments via PayMongo's hosted checkout.
 *                        The tenant pays on PayMongo's page, and PayMongo confirms
 *                        it by webhook.
 *
 * Sandbox methods are synchronous; callers `await` every gateway call, so both work.
 * Amounts are integer centavos, the unit PayMongo uses too.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

export const CHECKOUT_LIFETIME_MS = 30 * 60 * 1000;
const PAYMONGO_API = 'https://api.paymongo.com/v2';
const WEBHOOK_TOLERANCE_S = 5 * 60;

export class SandboxGCashGateway {
  name = 'sandbox';

  sandboxMode = true;

  createCheckout() {
    return { providerId: null, url: null };
  }

  /** Confirm the money arrived. In the sandbox it always has; returns a 13-digit GCash-style reference number. */
  verifyPayment() {
    let reference = String(randomInt(1, 10));
    while (reference.length < 13) reference += randomInt(0, 10);
    return { paid: true, reference };
  }
}

export class PayMongoGateway {
  name = 'paymongo';

  sandboxMode = false;

  /**
   * @param {object} options
   * @param {string} options.secretKey       PayMongo secret key (sk_test_... or sk_live_...)
   * @param {string} [options.webhookSecret] signing secret shown when the webhook is created
   * @param {string[]} [options.paymentMethods] e.g. ['gcash']
   * @param {Function} [options.fetchImpl]   injectable for tests
   */
  constructor({ secretKey, webhookSecret = '', paymentMethods = ['gcash'], fetchImpl = fetch }) {
    if (!secretKey) throw new Error('PayMongoGateway needs a secret key.');
    this.webhookSecret = webhookSecret;
    this.paymentMethods = paymentMethods;
    this.fetch = fetchImpl;
    this.auth = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;
  }

  async #request(method, path, body) {
    const response = await this.fetch(`${PAYMONGO_API}${path}`, {
      method,
      headers: { Authorization: this.auth, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.errors?.[0]?.detail || `HTTP ${response.status}`;
      throw new Error(`PayMongo ${method} ${path} failed: ${detail}`);
    }
    return data.data;
  }

  /**
   * Start a hosted checkout. Both success and cancel send the tenant back to `returnUrl`;
   * the checkout page then asks PayMongo whether the money arrived.
   */
  async createCheckout({ amount, reference, returnUrl }) {
    const session = await this.#request('POST', '/checkout_sessions', {
      data: {
        attributes: {
          line_items: [{ name: 'Rent payment', amount, currency: 'PHP', quantity: 1 }],
          payment_method_types: this.paymentMethods,
          success_url: returnUrl,
          cancel_url: returnUrl,
          reference_number: reference,
        },
      },
    });
    return { providerId: session.id, url: session.attributes.checkout_url };
  }

  /** Ask PayMongo whether this checkout has been paid. */
  async retrieveCheckout(providerId) {
    const session = await this.#request('GET', `/checkout_sessions/${encodeURIComponent(providerId)}`);
    const paid = (session.attributes?.payments || []).find((p) => p.attributes?.status === 'paid');
    return { paid: Boolean(paid), paymentId: paid?.id ?? null, amount: paid?.attributes?.amount ?? null };
  }

  /**
   * Check PayMongo's Paymongo-Signature header: "t=<unix time>,te=<test sig>,li=<live sig>",
   * where each signature is HMAC-SHA256(secret, "<t>.<raw body>"). Either signature is
   * accepted, since only someone holding the secret can produce one. Old requests are refused.
   */
  verifyWebhook(rawBody, header) {
    if (!this.webhookSecret || !header) return false;
    const parts = Object.fromEntries(
      String(header).split(',').map((part) => {
        const i = part.indexOf('=');
        return [part.slice(0, i).trim(), part.slice(i + 1).trim()];
      }),
    );
    const timestamp = Number(parts.t);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_S) return false;
    const expected = Buffer.from(
      createHmac('sha256', this.webhookSecret).update(`${parts.t}.${rawBody}`).digest('hex'),
    );
    return [parts.te, parts.li].some((signature) => {
      if (!signature) return false;
      const given = Buffer.from(signature);
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
  }
}

/** The gateway for this server: PayMongo when a secret key is configured, otherwise the sandbox. */
export function defaultGateway() {
  const { secretKey, webhookSecret, paymentMethods } = config.paymongo;
  if (!secretKey) return new SandboxGCashGateway();
  if (!webhookSecret) {
    console.warn('PAYMONGO_WEBHOOK_SECRET is not set: PayMongo payments will only be confirmed when the tenant returns to RentEase.');
  }
  return new PayMongoGateway({ secretKey, webhookSecret, paymentMethods });
}