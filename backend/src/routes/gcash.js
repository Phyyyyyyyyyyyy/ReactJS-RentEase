/**
 * Online GCash checkout and official receipts.
 *
 * 1. The tenant starts a checkout for an amount   -> POST /payments/<tenancy>/checkout/
 * 2. They open the checkout page                  -> GET  /payments/checkout/<code>/
 * 3. They pay:
 *    - sandbox: RentEase's own test screen confirms it at once (POST .../pay/)
 *    - PayMongo: .../pay/ returns PayMongo's GCash page to redirect to. The payment
 *      is recorded once PayMongo confirms it, either by its webhook
 *      (POST /api/payments/webhooks/paymongo/, see paymongoWebhook) or when the
 *      tenant comes back and the checkout page asks PayMongo.
 * 4. Any confirmed payment has a receipt          -> GET /payments/<payment>/receipt/
 */
import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { ledgerFor, person, tenanciesFor } from '../billing.js';
import { CHECKOUT_LIFETIME_MS, defaultGateway } from '../gcash.js';
import { Form } from '../lib/forms.js';
import { endpoint, fail, notFound, reply } from '../lib/http.js';
import { iso, money, nowIso, peso, today } from '../lib/format.js';
import { notify, runnersOfUnit } from '../notifications.js';
import { displayName, userBrief } from '../users.js';
import { METHOD_LABEL } from './payments.js';

/** Tell the owner and manager that an online payment came in. */
async function announcePayment(db, tenancy, amount) {
  await notify(db, await runnersOfUnit(db, tenancy.unit_id), 'payment',
    `${displayName(tenancy.tenant)} paid ${peso(amount)} online with GCash for ${tenancy.unit.name}. It already counts toward their balance.`,
    `/owner/payments/tenancy/${tenancy.id}`);
}

/**
 * Record a payment the provider has confirmed. It happens once per checkout: the first
 * confirmation (webhook or the tenant's return) records it, and repeats do nothing.
 * A payment that arrives after the checkout expired or was cancelled is still recorded,
 * because the money has already moved.
 */
async function recordProviderPayment(db, row) {
  const now = nowIso();
  const paymentId = await db.tx(async (t) => {
    const { changes } = await t.run("UPDATE gcash_checkouts SET status = 'paid' WHERE id = ? AND status <> 'paid'", [row.id]);
    if (!changes) return null;
    const id = await t.insert(
      `INSERT INTO payments (tenancy_id, amount, method, reference_number, paid_on, note, status, recorded_by_id,
         reviewed_at, created_at)
       VALUES (?, ?, 'gcash', ?, ?, 'Paid online with GCash', 'confirmed', ?, ?, ?)`,
      [row.tenancy_id, row.amount, row.provider_checkout_id, today(), row.tenant_id, now, now],
    );
    await t.run('UPDATE gcash_checkouts SET payment_id = ? WHERE id = ?', [id, row.id]);
    return id;
  });
  if (paymentId) {
    const [tenancy] = await tenanciesFor(db, { id: row.tenancy_id });
    if (tenancy) await announcePayment(db, tenancy, row.amount);
  }
  return paymentId;
}

/**
 * Ask the provider whether a pending checkout has been paid, and record it if so.
 * Returns true when a payment was recorded now. A PayMongo outage shows the page as
 * still pending instead of failing it.
 */
async function checkProvider(db, gateway, row) {
  if (row.status === 'paid' || !row.provider_checkout_id || row.provider !== gateway.name) return false;
  let remote;
  try {
    remote = await gateway.retrieveCheckout(row.provider_checkout_id);
  } catch (error) {
    console.error(error);
    return false;
  }
  // Only record it if the amount PayMongo charged is the amount on this checkout.
  if (!remote.paid || (remote.amount !== null && Number(remote.amount) !== row.amount)) return false;
  return Boolean(await recordProviderPayment(db, row));
}

/**
 * POST /api/payments/webhooks/paymongo/: PayMongo calls this when a checkout is paid.
 * PayMongo can't send a CSRF token or a session, so the signature check is what makes
 * it safe. Mounted in app.js before the JSON API, so it gets the raw body.
 */
export function paymongoWebhook(db, gateway) {
  return async (req, res) => {
    try {
      if (gateway.sandboxMode) return res.status(404).json({ message: 'Not found.' });
      const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
      if (!gateway.verifyWebhook(raw, req.get('Paymongo-Signature'))) {
        return res.status(401).json({ message: 'Invalid signature.' });
      }
      const event = JSON.parse(raw);
      const type = event?.data?.attributes?.type;
      const session = event?.data?.attributes?.data;
      if (type === 'checkout_session.payment.paid' && session?.id) {
        const row = await db.get(
          'SELECT * FROM gcash_checkouts WHERE provider = ? AND provider_checkout_id = ?', [gateway.name, session.id]);
        if (row) await recordProviderPayment(db, row);
      }
      return res.json({ received: true });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: 'The webhook could not be processed.' });
    }
  };
}

export default function gcashRoutes(db, { gateway = defaultGateway() } = {}) {
  const router = Router();
  const TENANT = ['tenant'];

  const positiveId = (value) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n <= 0) throw notFound();
    return n;
  };

  endpoint(router, '/payments/:id/checkout/', {
    roles: TENANT,
    POST: async (req) => {
      const [tenancy] = await tenanciesFor(db, { tenantId: req.user.id, id: positiveId(req.params.id) });
      if (!tenancy) throw notFound();
      const form = new Form(req.body);
      const amount = form.money('amount', { min: 1 });
      form.check();
      const code = randomBytes(18).toString('base64url');
      let remote;
      try {
        remote = await gateway.createCheckout({
          amount, reference: code, returnUrl: `${config.publicAppUrl}/payments/checkout/${code}?returned=1`,
        });
      } catch (error) {
        console.error(error);
        throw fail('GCash payments are not available right now. Please try again in a few minutes.', 502);
      }
      await db.run(
        `INSERT INTO gcash_checkouts (id, tenancy_id, tenant_id, amount, status, created_at, expires_at,
           provider, provider_checkout_id, provider_url)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
        [code, tenancy.id, req.user.id, amount, nowIso(),
          new Date(Date.now() + CHECKOUT_LIFETIME_MS).toISOString(), gateway.name, remote.providerId, remote.url],
      );
      return reply(201, { checkout_id: code, url: `/payments/checkout/${code}`, sandbox: gateway.sandboxMode });
    },
  });

  // Checkouts belong to the tenant who started them; anyone else gets a 404.
  async function ownCheckout(req) {
    const code = String(req.params.code || '');
    const row = /^[\w-]{10,64}$/.test(code) && await db.get(
      'SELECT * FROM gcash_checkouts WHERE id = ? AND tenant_id = ?', [code, req.user.id]);
    if (!row) throw notFound();
    const [tenancy] = await tenanciesFor(db, { tenantId: req.user.id, id: row.tenancy_id });
    if (!tenancy) throw notFound();
    const expired = row.status === 'pending' && row.expires_at <= nowIso();
    return { checkout: { ...row, status: expired ? 'expired' : row.status }, tenancy };
  }

  endpoint(router, '/payments/checkout/:code/', {
    roles: TENANT,
    GET: async (req) => {
      let { checkout, tenancy } = await ownCheckout(req);
      // The tenant is back from PayMongo, or the webhook hasn't arrived yet: ask PayMongo now.
      if (await checkProvider(db, gateway, checkout)) ({ checkout, tenancy } = await ownCheckout(req));
      return {
        checkout: {
          id: checkout.id,
          amount: money(checkout.amount),
          status: checkout.status,
          expires_at: iso(checkout.expires_at),
          payment_id: checkout.payment_id,
        },
        pay_to: { property: tenancy.property.name, unit: tenancy.unit.name, owner: displayName(tenancy.owner) },
        sandbox: gateway.sandboxMode,
      };
    },
  });

  endpoint(router, '/payments/checkout/:code/pay/', {
    roles: TENANT,
    POST: async (req) => {
      const { checkout, tenancy } = await ownCheckout(req);
      if (checkout.provider !== gateway.name) {
        throw fail('This checkout was started with a different payment setup. Please start a new payment.');
      }

      if (!gateway.sandboxMode) {
        // Real payment: send the tenant to PayMongo's page. Nothing is recorded until PayMongo confirms it.
        if (checkout.status === 'paid') throw fail('This checkout has already been paid.');
        if (checkout.status !== 'pending' || !checkout.provider_url) {
          throw fail(checkout.status === 'expired'
            ? 'This checkout expired. Start a new payment.'
            : 'This checkout was cancelled or is no longer available. Start a new payment.');
        }
        return { redirect_url: checkout.provider_url, message: 'Taking you to GCash to finish the payment.' };
      }

      // Sandbox: the payment is confirmed right here.
      const now = nowIso();
      const paymentId = await db.tx(async (t) => {
        // Only a pending, unexpired checkout can be paid, and only once.
        const { changes } = await t.run(
          "UPDATE gcash_checkouts SET status = 'paid' WHERE id = ? AND status = 'pending' AND expires_at > ?",
          [checkout.id, now]);
        if (!changes) throw fail('This checkout has expired or was already used. Start a new payment.');
        const result = gateway.verifyPayment({ checkoutId: checkout.id });
        if (!result.paid) throw fail('GCash did not confirm the payment. Nothing was charged.');
        const id = await t.insert(
          `INSERT INTO payments (tenancy_id, amount, method, reference_number, paid_on, note, status, recorded_by_id,
             reviewed_at, created_at)
           VALUES (?, ?, 'gcash', ?, ?, 'Paid online with GCash (sandbox test)', 'confirmed', ?, ?, ?)`,
          [tenancy.id, checkout.amount, result.reference, today(), req.user.id, now, now],
        );
        await t.run('UPDATE gcash_checkouts SET payment_id = ? WHERE id = ?', [id, checkout.id]);
        return id;
      });
      await announcePayment(db, tenancy, checkout.amount);
      return { payment_id: paymentId, message: `Paid ${peso(checkout.amount)} with GCash. Your receipt is ready.` };
    },
  });

  endpoint(router, '/payments/checkout/:code/cancel/', {
    roles: TENANT,
    POST: async (req) => {
      const { checkout } = await ownCheckout(req);
      await db.run("UPDATE gcash_checkouts SET status = 'cancelled' WHERE id = ? AND status = 'pending'", [checkout.id]);
      return { message: 'Payment cancelled. Nothing was charged.' };
    },
  });

  endpoint(router, '/payments/:id/receipt/', {
    roles: ['tenant', 'owner', 'manager'],
    GET: async (req) => {
      const p = await db.get(
        `SELECT pay.*, a.tenant_id, a.unit_id, u.name AS unit_name, p.name AS property_name, p.address, p.city,
           p.owner_id, p.manager_id,
           t.username AS t_username, t.first_name AS t_first_name, t.last_name AS t_last_name, t.email AS t_email,
           t.phone AS t_phone, t.profile_photo AS t_profile_photo,
           o.username AS o_username, o.first_name AS o_first_name, o.last_name AS o_last_name
         FROM payments pay JOIN applications a ON a.id = pay.tenancy_id JOIN units u ON u.id = a.unit_id
         JOIN properties p ON p.id = u.property_id JOIN users t ON t.id = a.tenant_id JOIN users o ON o.id = p.owner_id
         WHERE pay.id = ? AND pay.status = 'confirmed'`,
        [positiveId(req.params.id)],
      );
      // Only the tenant who paid, and the owner or manager of the property, can see a receipt.
      const me = req.user.id;
      if (!p || (me !== p.tenant_id && me !== p.owner_id && me !== p.manager_id)) throw notFound();
      const [tenancy] = await tenanciesFor(db, { id: p.tenancy_id });
      const ledger = tenancy ? await ledgerFor(db, tenancy) : null;
      return {
        receipt: {
          number: `RE-${String(p.id).padStart(6, '0')}`,
          amount: money(p.amount),
          method: p.method,
          method_display: METHOD_LABEL[p.method],
          reference_number: p.reference_number,
          paid_on: p.paid_on,
          confirmed_at: iso(p.reviewed_at || p.created_at),
          note: p.note,
          tenant: userBrief(person(p, 't', p.tenant_id), { contact: true }),
          received_by: displayName(person(p, 'o', p.owner_id)),
          property: { name: p.property_name, address: p.address, city: p.city },
          unit: p.unit_name,
          balance_now: ledger ? money(ledger.balance) : null,
          credit_now: ledger ? money(ledger.credit) : null,
        },
      };
    },
  });

  return router;
}