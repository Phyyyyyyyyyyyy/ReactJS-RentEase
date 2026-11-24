/**
 * Leasing API: tenants view their leases; owners and property managers renew,
 * terminate, or set the deposit of leases on the properties they run.
 */
import { Router } from 'express';
import { latestApprovedByUnit, leaseState, tenanciesFor } from '../billing.js';
import { Form } from '../lib/forms.js';
import { endpoint, fail, notFound } from '../lib/http.js';
import { addDays, nowIso, peso, today } from '../lib/format.js';
import { leaseJson } from '../leases.js';
import { notify } from '../notifications.js';
import { displayName } from '../users.js';
import { RUNNERS } from './properties.js';

export default function leasesRoutes(db) {
  const router = Router();

  // Leases are found through their tenancy, filtered by who's asking (404 for anyone else's).
  async function runnerTenancyByLease(req) {
    const leaseId = Number(req.params.id);
    if (!Number.isSafeInteger(leaseId) || leaseId <= 0) throw notFound();
    const row = await db.get('SELECT application_id FROM leases WHERE id = ?', [leaseId]);
    const [tenancy] = row ? await tenanciesFor(db, { runnerId: req.user.id, id: row.application_id }) : [];
    if (!tenancy) throw notFound();
    return tenancy;
  }

  endpoint(router, '/leases/', {
    roles: ['tenant'],
    GET: async (req) => {
      const tenancies = (await tenanciesFor(db, { tenantId: req.user.id })).filter((t) => t.lease);
      return {
        leases: tenancies.map((t) => ({
          ...leaseJson(t.lease),
          tenancy_id: t.id,
          unit: { id: t.unit.id, name: t.unit.name },
          property: { id: t.property.id, name: t.property.name },
        })),
      };
    },
  });

  endpoint(router, '/owner/leases/:id/', {
    roles: RUNNERS,
    // Set the security deposit (money held, not rent; it doesn't count toward the balance).
    PUT: async (req) => {
      const tenancy = await runnerTenancyByLease(req);
      const form = new Form(req.body);
      const deposit = form.money('deposit', { min: 0 });
      form.check();
      await db.run('UPDATE leases SET deposit = ?, updated_at = ? WHERE id = ?', [deposit, nowIso(), tenancy.lease.id]);
      return { message: `Deposit for ${tenancy.unit.name} set to ${peso(deposit)}.` };
    },
  });

  endpoint(router, '/owner/leases/:id/renew/', {
    roles: RUNNERS,
    POST: async (req) => {
      const tenancy = await runnerTenancyByLease(req);
      const { lease } = tenancy;
      if (leaseState(lease) === 'terminated') throw fail('A terminated lease can’t be renewed. The tenant needs to apply again.');
      const form = new Form(req.body);
      const endDate = form.date('end_date');
      // A new rent applies to months not billed yet.
      const rent = form.money('monthly_rent', { required: false });
      if (endDate && form.ok('end_date') && endDate <= lease.end_date) {
        form.error('end_date', `The new end date must be after the current one (${lease.end_date}).`);
      }
      if (rent !== null && form.ok('monthly_rent') && rent <= 0) form.error('monthly_rent', 'Monthly rent must be greater than zero.');
      form.check();
      await db.run('UPDATE leases SET end_date = ?, monthly_rent = ?, status = ?, updated_at = ? WHERE id = ?',
        [endDate, rent ?? lease.monthly_rent, 'active', nowIso(), lease.id]);
      await notify(db, tenancy.tenant_id, 'lease', `Your lease for ${tenancy.property.name} ${tenancy.unit.name} was renewed until ${endDate}.`, '/payments');
      return { message: `Lease for ${tenancy.unit.name} renewed until ${endDate}.` };
    },
  });

  endpoint(router, '/owner/leases/:id/terminate/', {
    roles: RUNNERS,
    POST: async (req) => {
      const tenancy = await runnerTenancyByLease(req);
      const { lease } = tenancy;
      if (leaseState(lease) !== 'active') throw fail('Only an active lease can be terminated.');
      const day = today();
      // Billing stops after this month. A lease ended before it started bills nothing.
      const end = lease.start_date > day ? addDays(lease.start_date, -1) : day;
      const now = nowIso();
      await db.tx(async (t) => {
        const { changes } = await t.run(
          "UPDATE leases SET status = 'terminated', end_date = ?, terminated_at = ?, updated_at = ? WHERE id = ? AND status = 'active'",
          [end < lease.end_date ? end : lease.end_date, now, now, lease.id]);
        if (!changes) throw fail('Only an active lease can be terminated.');
        // The unit is free again if this was its current tenant.
        const latest = await latestApprovedByUnit(t, [tenancy.unit_id]);
        if (latest.get(tenancy.unit_id) === tenancy.id) {
          await t.run("UPDATE units SET status = 'vacant' WHERE id = ?", [tenancy.unit_id]);
        }
      });
      await notify(db, tenancy.tenant_id, 'lease', `Your lease for ${tenancy.property.name} ${tenancy.unit.name} was terminated.`, '/payments');
      return { message: `Lease for ${displayName(tenancy.tenant)} (${tenancy.unit.name}) terminated. The unit is now vacant.` };
    },
  });

  return router;
}
