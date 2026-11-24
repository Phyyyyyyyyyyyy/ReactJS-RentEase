/**
 * GCashGateway: online GCash payments.
 *
 * Only SANDBOX mode exists: the checkout page is RentEase's own test screen and
 * no real money moves. Taking real GCash payments needs a merchant account with
 * a payment provider (e.g. PayMongo, Xendit, or Maya); a real gateway would
 * implement the same two methods, createCheckout() and verifyPayment().
 */
import { randomBytes, randomInt } from 'node:crypto';

const CHECKOUT_LIFETIME_MS = 30 * 60 * 1000;

export class SandboxGCashGateway {
  sandboxMode = true;

  /** Start a checkout; returns its id and when it expires. The tenant is sent to /payments/checkout/<id>. */
  createCheckout() {
    return {
      id: randomBytes(18).toString('base64url'),
      expiresAt: new Date(Date.now() + CHECKOUT_LIFETIME_MS).toISOString(),
    };
  }

  /** Confirm the money arrived. In the sandbox it always has; returns a 13-digit GCash-style reference number. */
  verifyPayment() {
    let reference = String(randomInt(1, 10));
    while (reference.length < 13) reference += randomInt(0, 10);
    return { paid: true, reference };
  }
}

export const defaultGateway = () => new SandboxGCashGateway();
