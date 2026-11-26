/**
 * Online GCash checkout (sandbox) and official receipts.
 *
 * 1. The tenant starts a checkout for an amount  -> POST /payments/<tenancy>/checkout/
 * 2. They open the checkout page and pay         -> POST /payments/checkout/<code>/pay/
 *    The gateway verifies the payment, so it is recorded as CONFIRMED right
 *    away (unlike a manual GCash reference, which the owner has to check).
 * 3. Any confirmed payment has a receipt          -> GET /payments/<payment>/receipt/
 */
import { Router } from 'express';
import { ledgerFor, person, tenanciesFor } from '../billing.js';
import { defaultGateway } from '../gcash.js';
import { Form } from '../lib/forms.js';
import { endpoint, fail, notFound, reply } from '../lib/http.js';
import { iso, money, nowIso, peso, today } from '../lib/format.js';
import { notify, runnersOfUnit } from '../notifications.js';
import { displayName, userBrief } from '../users.js';
import { METHOD_LABEL } from './payments.js';


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
      const checkout = gateway.createCheckout({ amount, tenancyId: tenancy.id });
      await db.run(
        `INSERT INTO gcash_checkouts (id, tenancy_id, tenant_id, amount, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
        [checkout.id, tenancy.id, req.user.id, amount, nowIso(), checkout.expiresAt],
      );
      return reply(201, { checkout_id: checkout.id, url: `/payments/checkout/${checkout.id}`, sandbox: gateway.sandboxMode });
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
      const { checkout, tenancy } = await ownCheckout(req);
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
           VALUES (?, ?, 'gcash', ?, ?, ?, 'confirmed', ?, ?, ?)`,
          [tenancy.id, checkout.amount, result.reference, today(),
            gateway.sandboxMode ? 'Paid online with GCash (sandbox test)' : 'Paid online with GCash', req.user.id, now, now],
        );
        await t.run('UPDATE gcash_checkouts SET payment_id = ? WHERE id = ?', [id, checkout.id]);
        return id;
      });
      await notify(db, await runnersOfUnit(db, tenancy.unit_id), 'payment',
        `${displayName(tenancy.tenant)} paid ${peso(checkout.amount)} online with GCash for ${tenancy.unit.name}. It already counts toward their balance.`,
        `/owner/payments/tenancy/${tenancy.id}`);
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
