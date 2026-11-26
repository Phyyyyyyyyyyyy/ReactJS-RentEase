/**
 * Properties API.
 *
 * Tenant endpoints filter by the signed-in tenant and owner endpoints by the
 * signed-in owner, so nobody can view or change another person's properties,
 * units, or applications (they get a 404).
 */
import { Router } from 'express';
import { isUniqueViolation } from '../db.js';
import { Form } from '../lib/forms.js';
import { endpoint, fail, formErrors, HttpError, notFound, reply } from '../lib/http.js';
import { iso, money, nowIso, today } from '../lib/format.js';
import { createLease } from '../leases.js';
import { notify, runnersOfUnit } from '../notifications.js';
import { displayName, userBrief } from '../users.js';

export const PROPERTY_TYPES = [
  ['apartment', 'Apartment'],
  ['house', 'House'],
  ['townhouse', 'Townhouse'],
  ['studio', 'Studio'],
  ['condo', 'Condominium'],
  ['boarding', 'Boarding House'],
];
const TYPE_LABEL = Object.fromEntries(PROPERTY_TYPES);

export const UNIT_STATUSES = [['vacant', 'Vacant'], ['occupied', 'Occupied']];

export const LISTING_TYPES = [['rent', 'For rent'], ['rent_to_own', 'Rent-to-own']];
const LISTING_LABEL = Object.fromEntries(LISTING_TYPES);

/** "Monthly", "Every 2 months", ... */
export const intervalLabel = (months) => (!months || months === 1 ? 'Monthly' : `Every ${months} months`);

/** 500 basis points -> "5.00" (percent per year). */
export const percent = (bp) => (bp === null || bp === undefined ? null : money(bp));

export const APPLICATION_STATUSES = [
  ['pending', 'Pending'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['withdrawn', 'Withdrawn'],
];
const STATUS_LABEL = Object.fromEntries(APPLICATION_STATUSES);

const TENANT = ['tenant'];
const OWNER = ['owner'];
// Owners and Property Managers both run properties.
export const RUNNERS = ['owner', 'manager'];

/** SQL: the signed-in user owns or manages property `alias` (params: user id twice). */
export const RUNS = (alias) => `(${alias}.owner_id = ? OR ${alias}.manager_id = ?)`;

const MANAGER_JOIN = 'LEFT JOIN users m ON m.id = p.manager_id';
const MANAGER_COLUMNS = `m.username AS m_username, m.first_name AS m_first_name, m.last_name AS m_last_name,
  m.email AS m_email, m.phone AS m_phone, m.profile_photo AS m_profile_photo`;

/** Only the owner may change a property, its units, or its manager. */
function requireOwner(req) {
  if (req.user.role !== 'owner') {
    throw new HttpError(403, { message: 'Only the property owner can change this.' });
  }
}

// ------------------------------------------------------------------ JSON shapes

export function propertyJson(p) {
  const data = {
    id: p.id,
    name: p.name,
    property_type: p.property_type,
    type_display: TYPE_LABEL[p.property_type],
    address: p.address,
    city: p.city,
    description: p.description,
    amenities: p.amenities,
    amenity_list: p.amenities.split(',').map((a) => a.trim()).filter(Boolean),
  };
  for (const extra of ['vacant_count', 'unit_count', 'pending_count']) {
    if (extra in p) data[extra] = Number(p[extra]);
  }
  if ('min_rent' in p) data.min_rent = money(p.min_rent);
  // The assigned Property Manager, when the query joined it in.
  if ('m_username' in p) {
    data.manager = p.manager_id ? userBrief({ id: p.manager_id, username: p.m_username, first_name: p.m_first_name,
      last_name: p.m_last_name, email: p.m_email, phone: p.m_phone, profile_photo: p.m_profile_photo }, { contact: true }) : null;
  }
  return data;
}

export function unitJson(u) {
  const data = {
    id: u.id,
    name: u.name,
    bedrooms: u.bedrooms,
    bathrooms: u.bathrooms,
    floor_area: u.floor_area,
    monthly_rent: money(u.monthly_rent),
    status: u.status,
    is_vacant: u.status === 'vacant',
    listing_type: u.listing_type || 'rent',
    listing_display: LISTING_LABEL[u.listing_type || 'rent'],
    payment_interval_months: u.payment_interval_months || 1,
    payment_terms: intervalLabel(u.payment_interval_months),
  };
  if (u.listing_type === 'rent_to_own') {
    Object.assign(data, {
      contract_price: money(u.contract_price),
      term_years: u.term_years,
      interest_rate: percent(u.interest_rate_bp),
      reservation_fee: money(u.reservation_fee),
    });
  }
  if ('pending_count' in u) data.pending_count = Number(u.pending_count);
  return data;
}

const APPLICATION_SELECT = `
  SELECT a.*, u.name AS unit_name, u.monthly_rent AS unit_rent, u.status AS unit_status, u.property_id,
    p.name AS property_name, p.address AS property_address, p.city AS property_city, p.owner_id,
    t.username AS t_username, t.first_name AS t_first_name, t.last_name AS t_last_name,
    t.email AS t_email, t.phone AS t_phone, t.profile_photo AS t_profile_photo
  FROM applications a
  JOIN units u ON u.id = a.unit_id
  JOIN properties p ON p.id = u.property_id
  JOIN users t ON t.id = a.tenant_id`;

const tenantOf = (a) => ({
  id: a.tenant_id, username: a.t_username, first_name: a.t_first_name, last_name: a.t_last_name,
  email: a.t_email, phone: a.t_phone, profile_photo: a.t_profile_photo,
});

function applicationJson(a, { forOwner = false } = {}) {
  const data = {
    id: a.id,
    status: a.status,
    status_display: STATUS_LABEL[a.status],
    message: a.message,
    preferred_move_in: iso(a.preferred_move_in),
    created_at: iso(a.created_at),
    can_withdraw: a.status === 'pending',
    unit: {
      id: a.unit_id,
      name: a.unit_name,
      monthly_rent: money(a.unit_rent),
      is_vacant: a.unit_status === 'vacant',
      property: { id: a.property_id, name: a.property_name, address: a.property_address, city: a.property_city },
    },
  };
  if (forOwner) data.tenant = userBrief(tenantOf(a), { contact: true });
  return data;
}

/** Status tabs with counts, and the list filtered to the chosen status. */
async function applicationList(db, where, params, requested, { allFirst }) {
  const rows = await db.all(`${APPLICATION_SELECT} WHERE ${where} ORDER BY a.created_at DESC, a.id DESC`, params);
  const counts = Object.fromEntries(APPLICATION_STATUSES.map(([s]) => [s, 0]));
  for (const row of rows) counts[row.status] += 1;
  const tabs = APPLICATION_STATUSES.map(([value, label]) => ({ value, label, count: counts[value] }));
  const everything = { value: allFirst ? '' : 'all', label: 'All', count: rows.length };
  const valid = requested in counts;
  return {
    status: valid ? requested : everything.value,
    status_tabs: allFirst ? [everything, ...tabs] : [...tabs, everything],
    rows: valid ? rows.filter((r) => r.status === requested) : rows,
  };
}

// ------------------------------------------------------------------------ forms

function moveInDate(form) {
  const date = form.date('preferred_move_in', { required: false });
  if (date && date < today()) form.error('preferred_move_in', 'Move-in date cannot be in the past.');
  return date;
}

async function cleanProperty(db, body, ownerId, exceptId = 0) {
  const form = new Form(body);
  const values = {
    name: form.text('name', { max: 150 }),
    property_type: form.choice('property_type', PROPERTY_TYPES),
    address: form.text('address', { max: 255 }),
    city: form.text('city', { max: 100 }),
    description: form.text('description', { required: false }),
    amenities: form.text('amenities', { required: false, max: 255 }),
  };
  if (values.name && values.address && values.city && form.ok('name') && form.ok('address') && form.ok('city')) {
    const clash = await db.get(
      `SELECT 1 AS x FROM properties WHERE owner_id = ? AND LOWER(name) = LOWER(?) AND LOWER(address) = LOWER(?)
       AND LOWER(city) = LOWER(?) AND id <> ?`,
      [ownerId, values.name, values.address, values.city, exceptId],
    );
    if (clash) form.formError('You already have a property with this name at this address.');
  }
  form.check();
  return values;
}

const DUPLICATE_PROPERTY = () => formErrors({ non_field_errors: ['You already have a property with this name at this address.'] });

async function cleanUnit(db, body, propertyId, current = null) {
  const exceptId = current ? current.id : 0;
  const form = new Form(body);
  const values = {
    name: form.text('name', { max: 100 }),
    bedrooms: form.integer('bedrooms', { min: 0, max: 32767 }),
    bathrooms: form.integer('bathrooms', { min: 0, max: 32767 }),
    floor_area: form.integer('floor_area', { min: 0, max: 2147483647 }),
    monthly_rent: form.money('monthly_rent'),
    status: form.choice('status', UNIT_STATUSES),
    // Editing without sending a type keeps the unit's current one.
    listing_type: form.has('listing_type') ? form.choice('listing_type', LISTING_TYPES) : (current?.listing_type || 'rent'),
    contract_price: null,
    term_years: null,
    interest_rate_bp: null,
    reservation_fee: 0,
    // Payment terms: pay every N months (1 to 12). Editing without it keeps the current terms.
    payment_interval_months: form.has('payment_interval_months')
      ? form.integer('payment_interval_months', { min: 1, max: 12 })
      : (current?.payment_interval_months || 1),
  };
  // Rent-to-own units also need the contract terms. monthly_rent is then the monthly payment.
  if (values.listing_type === 'rent_to_own') {
    values.contract_price = form.money('contract_price', { min: 1 });
    values.term_years = form.integer('term_years', { min: 1, max: 50 });
    // Stored in basis points (5% = 500); recorded for reference, not used to compute payments.
    values.interest_rate_bp = form.money('interest_rate', { required: false, min: 0 });
    if (values.interest_rate_bp !== null && form.ok('interest_rate') && values.interest_rate_bp > 10000) {
      form.error('interest_rate', 'Ensure this value is less than or equal to 100.');
    }
    values.reservation_fee = form.money('reservation_fee', { required: false, min: 0 }) ?? 0;
    if (values.contract_price && values.monthly_rent && form.ok('contract_price') && form.ok('monthly_rent')
      && values.monthly_rent > values.contract_price) {
      form.error('monthly_rent', 'The monthly payment can’t be more than the contract price.');
    }
  }
  if (values.name && form.ok('name')) {
    const clash = await db.get('SELECT 1 AS x FROM units WHERE property_id = ? AND LOWER(name) = LOWER(?) AND id <> ?',
      [propertyId, values.name, exceptId]);
    if (clash) form.error('name', 'This property already has a unit with that name.');
  }
  if (values.monthly_rent !== null && form.ok('monthly_rent') && values.monthly_rent <= 0) {
    form.error('monthly_rent', values.listing_type === 'rent_to_own' ? 'The monthly payment must be greater than zero.' : 'Monthly rent must be greater than zero.');
  }
  form.check();
  return values;
}

const DUPLICATE_UNIT = () => formErrors({ name: ['This property already has a unit with that name.'] });

// ---------------------------------------------------------------------- routes

export default function propertiesRoutes(db) {
  const router = Router();
  const id = (req, name = 'id') => {
    const n = Number(req.params[name]);
    if (!Number.isSafeInteger(n) || n <= 0) throw notFound();
    return n;
  };

  // ---------------------------------------------------------------- tenant

  endpoint(router, '/browse/', {
    roles: TENANT,
    GET: async (req) => {
      const query = req.query;
      const bound = Object.keys(query).length > 0;
      const form = new Form(bound ? query : {});
      const q = form.text('q', { required: false });
      const type = form.choice('type', PROPERTY_TYPES, { required: false });
      const maxRent = form.integer('max_rent', { required: false, min: 0 });
      const invalid = bound && !form.valid;

      const where = [];
      const params = [];
      let having = '';
      if (bound && !invalid) {
        if (q) {
          const like = `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
          where.push("(LOWER(p.name) LIKE ? ESCAPE '\\' OR LOWER(p.address) LIKE ? ESCAPE '\\' OR LOWER(p.city) LIKE ? ESCAPE '\\')");
          params.push(like, like, like);
        }
        if (type) {
          where.push('p.property_type = ?');
          params.push(type);
        }
        if (maxRent !== null) {
          having = ' HAVING MIN(u.monthly_rent) <= ?';
          params.push(maxRent * 100);
        }
      }
      const properties = await db.all(
        `SELECT p.*, COUNT(u.id) AS vacant_count, MIN(u.monthly_rent) AS min_rent
         FROM properties p JOIN units u ON u.property_id = p.id AND u.status = 'vacant'
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         GROUP BY p.id${having}
         ORDER BY p.name, p.id`,
        params,
      );
      return { properties: properties.map(propertyJson), invalid_filter: invalid };
    },
  });

  endpoint(router, '/browse/:id/', {
    roles: TENANT,
    GET: async (req) => {
      const prop = await db.get('SELECT * FROM properties WHERE id = ?', [id(req)]);
      if (!prop) throw notFound();
      const owner = await db.get('SELECT * FROM users WHERE id = ?', [prop.owner_id]);
      const units = await db.all('SELECT * FROM units WHERE property_id = ? ORDER BY name, id', [prop.id]);
      const pending = await db.all(
        `SELECT a.unit_id FROM applications a JOIN units u ON u.id = a.unit_id
         WHERE a.tenant_id = ? AND a.status = 'pending' AND u.property_id = ? ORDER BY a.created_at DESC, a.id DESC`,
        [req.user.id, prop.id],
      );
      return {
        property: propertyJson(prop),
        owner: { full_name: displayName(owner), phone: owner.phone },
        units: units.map((u) => unitJson(u)),
        pending_unit_ids: pending.map((r) => r.unit_id),
        can_apply: units.some((u) => u.status === 'vacant'),
      };
    },
  });

  endpoint(router, '/browse/:id/apply/', {
    roles: TENANT,
    POST: async (req) => {
      const prop = await db.get('SELECT * FROM properties WHERE id = ?', [id(req)]);
      if (!prop) throw notFound();
      const form = new Form(req.body);
      const unitId = form.text('unit');
      if (!form.ok('unit')) form.errors.unit = ['Please choose a vacant unit.'];
      let unit;
      if (unitId) {
        // Only this property's vacant units can be chosen.
        unit = /^\d+$/.test(unitId) && await db.get(
          "SELECT * FROM units WHERE id = ? AND property_id = ? AND status = 'vacant'", [Number(unitId), prop.id]);
        if (!unit) form.error('unit', 'Select a valid choice. That choice is not one of the available choices.');
      }
      const moveIn = moveInDate(form);
      const message = form.text('message', { required: false });
      const alreadyPending = 'You already have a pending application for this unit.';
      if (unit && await db.get("SELECT 1 AS x FROM applications WHERE tenant_id = ? AND unit_id = ? AND status = 'pending'",
        [req.user.id, unit.id])) {
        form.formError(alreadyPending);
      }
      form.check();
      const now = nowIso();
      let applicationId;
      try {
        applicationId = await db.insert(
          `INSERT INTO applications (tenant_id, unit_id, message, preferred_move_in, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
          [req.user.id, unit.id, message, moveIn, now, now],
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw formErrors({ non_field_errors: [alreadyPending] });
        throw error;
      }
      await notify(db, await runnersOfUnit(db, unit.id), 'application',
        `${displayName(req.user)} applied for ${unit.name} at ${prop.name}.`, '/owner/applications');
      return reply(201, {
        id: applicationId,
        message: `Application for ${unit.name} submitted. The owner will review it soon.`,
      });
    },
  });

  endpoint(router, '/applications/', {
    roles: TENANT,
    GET: async (req) => {
      const list = await applicationList(db, 'a.tenant_id = ?', [req.user.id], String(req.query.status ?? ''),
        { allFirst: true });
      return { status: list.status, status_tabs: list.status_tabs, applications: list.rows.map((a) => applicationJson(a)) };
    },
  });

  // Filtering by tenant means a tenant can only see and edit their own applications.
  const ownApplication = async (req) => {
    const a = await db.get(`${APPLICATION_SELECT} WHERE a.id = ? AND a.tenant_id = ?`, [id(req), req.user.id]);
    if (!a) throw notFound();
    return a;
  };

  endpoint(router, '/applications/:id/', {
    roles: TENANT,
    GET: async (req) => ({ application: applicationJson(await ownApplication(req)) }),
    PUT: async (req) => {
      const a = await ownApplication(req);
      if (a.status !== 'pending') throw fail('Only pending applications can be edited.');
      const form = new Form(req.body);
      const moveIn = moveInDate(form);
      const message = form.text('message', { required: false });
      form.check();
      const { changes } = await db.run(
        "UPDATE applications SET preferred_move_in = ?, message = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
        [moveIn, message, nowIso(), a.id],
      );
      if (!changes) throw fail('Only pending applications can be edited.');
      return { message: `Application for ${a.unit_name} updated.` };
    },
  });

  endpoint(router, '/applications/:id/withdraw/', {
    roles: TENANT,
    POST: async (req) => {
      const a = await ownApplication(req);
      const { changes } = await db.run(
        "UPDATE applications SET status = 'withdrawn', updated_at = ? WHERE id = ? AND status = 'pending'",
        [nowIso(), a.id],
      );
      if (!changes) throw fail('Only pending applications can be withdrawn.');
      return { message: `Application for ${a.unit_name} withdrawn.` };
    },
  });

  // ------------------------------------------------------- owner and manager
  //
  // Owners run their own properties. A Property Manager runs the properties an
  // owner assigned to them: they can view them, review applications, and handle
  // payments, but only the owner can edit properties and units or assign managers.

  /** A property the signed-in owner owns (for changes). */
  const ownProperty = async (req) => {
    requireOwner(req);
    const prop = await db.get('SELECT * FROM properties WHERE id = ? AND owner_id = ?', [id(req), req.user.id]);
    if (!prop) throw notFound();
    return prop;
  };

  /** A property the signed-in owner owns or manager manages (for viewing). */
  const runProperty = async (req) => {
    const prop = await db.get(`SELECT p.*, ${MANAGER_COLUMNS} FROM properties p ${MANAGER_JOIN} WHERE p.id = ? AND ${RUNS('p')}`,
      [id(req), req.user.id, req.user.id]);
    if (!prop) throw notFound();
    return prop;
  };

  endpoint(router, '/owner/properties/', {
    roles: RUNNERS,
    GET: async (req) => {
      const properties = await db.all(
        `SELECT p.*, ${MANAGER_COLUMNS},
           (SELECT COUNT(*) FROM units u WHERE u.property_id = p.id) AS unit_count,
           (SELECT COUNT(*) FROM units u WHERE u.property_id = p.id AND u.status = 'vacant') AS vacant_count,
           (SELECT COUNT(*) FROM applications a JOIN units u ON u.id = a.unit_id
             WHERE u.property_id = p.id AND a.status = 'pending') AS pending_count
         FROM properties p ${MANAGER_JOIN} WHERE ${RUNS('p')} ORDER BY p.name, p.id`,
        [req.user.id, req.user.id],
      );
      return { properties: properties.map(propertyJson) };
    },
    POST: async (req) => {
      requireOwner(req);
      const values = await cleanProperty(db, req.body, req.user.id);
      let newId;
      try {
        newId = await db.insert(
          `INSERT INTO properties (owner_id, name, property_type, address, city, description, amenities, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [req.user.id, values.name, values.property_type, values.address, values.city, values.description,
            values.amenities, nowIso()],
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw DUPLICATE_PROPERTY();
        throw error;
      }
      const prop = await db.get('SELECT * FROM properties WHERE id = ?', [newId]);
      return reply(201, { property: propertyJson(prop), message: `${prop.name} added. Now add its units so tenants can apply.` });
    },
  });

  endpoint(router, '/owner/properties/:id/', {
    roles: RUNNERS,
    GET: async (req) => {
      const prop = await runProperty(req);
      const units = await db.all(
        `SELECT u.*, (SELECT COUNT(*) FROM applications a WHERE a.unit_id = u.id AND a.status = 'pending') AS pending_count
         FROM units u WHERE u.property_id = ? ORDER BY u.name, u.id`,
        [prop.id],
      );
      return { property: propertyJson(prop), units: units.map(unitJson), can_edit: req.user.role === 'owner' };
    },
    PUT: async (req) => {
      const prop = await ownProperty(req);
      const values = await cleanProperty(db, req.body, req.user.id, prop.id);
      try {
        await db.run(
          `UPDATE properties SET name = ?, property_type = ?, address = ?, city = ?, description = ?, amenities = ?
           WHERE id = ?`,
          [values.name, values.property_type, values.address, values.city, values.description, values.amenities, prop.id],
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw DUPLICATE_PROPERTY();
        throw error;
      }
      const updated = await db.get('SELECT * FROM properties WHERE id = ?', [prop.id]);
      return { property: propertyJson(updated), message: `${updated.name} updated.` };
    },
    DELETE: async (req) => {
      const prop = await ownProperty(req);
      await db.run('DELETE FROM properties WHERE id = ?', [prop.id]); // its units and applications go too
      return { message: `${prop.name} deleted.` };
    },
  });

  // The owner picks a Property Manager for a property (or none).
  endpoint(router, '/owner/properties/:id/manager/', {
    roles: OWNER,
    PUT: async (req) => {
      const prop = await ownProperty(req);
      const form = new Form(req.body);
      const choice = form.text('manager', { required: false });
      let manager = null;
      if (choice) {
        manager = /^\d+$/.test(choice)
          && await db.get("SELECT * FROM users WHERE id = ? AND role = 'manager' AND is_active = 1", [Number(choice)]);
        if (!manager) form.error('manager', 'Select a valid choice. That choice is not one of the available choices.');
      }
      form.check();
      await db.run('UPDATE properties SET manager_id = ? WHERE id = ?', [manager ? manager.id : null, prop.id]);
      return {
        message: manager ? `${displayName(manager)} now manages ${prop.name}.` : `${prop.name} no longer has a manager.`,
      };
    },
  });

  // Active Property Managers an owner can assign.
  endpoint(router, '/owner/managers/', {
    roles: OWNER,
    GET: async () => {
      const managers = await db.all(
        "SELECT * FROM users WHERE role = 'manager' AND is_active = 1 ORDER BY first_name, last_name, username");
      return { managers: managers.map((m) => userBrief(m, { contact: true })) };
    },
  });

  endpoint(router, '/owner/properties/:id/units/', {
    roles: OWNER,
    POST: async (req) => {
      const prop = await ownProperty(req);
      const values = await cleanUnit(db, req.body, prop.id);
      let unitId;
      try {
        unitId = await db.insert(
          `INSERT INTO units (property_id, name, bedrooms, bathrooms, floor_area, monthly_rent, status, listing_type,
             contract_price, term_years, interest_rate_bp, reservation_fee, payment_interval_months)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [prop.id, values.name, values.bedrooms, values.bathrooms, values.floor_area, values.monthly_rent, values.status,
            values.listing_type, values.contract_price, values.term_years, values.interest_rate_bp, values.reservation_fee,
            values.payment_interval_months],
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw DUPLICATE_UNIT();
        throw error;
      }
      const unit = await db.get('SELECT * FROM units WHERE id = ?', [unitId]);
      return reply(201, { unit: unitJson(unit), message: `${unit.name} added to ${prop.name}.` });
    },
  });

  const ownUnit = async (req) => {
    const unit = await db.get(
      `SELECT u.*, p.name AS property_name FROM units u JOIN properties p ON p.id = u.property_id
       WHERE u.id = ? AND p.owner_id = ?`,
      [id(req), req.user.id],
    );
    if (!unit) throw notFound();
    return unit;
  };

  endpoint(router, '/owner/units/:id/', {
    roles: OWNER,
    GET: async (req) => {
      const unit = await ownUnit(req);
      return { unit: unitJson(unit), property: { id: unit.property_id, name: unit.property_name } };
    },
    PUT: async (req) => {
      const unit = await ownUnit(req);
      const values = await cleanUnit(db, req.body, unit.property_id, unit);
      try {
        await db.run(
          `UPDATE units SET name = ?, bedrooms = ?, bathrooms = ?, floor_area = ?, monthly_rent = ?, status = ?,
             listing_type = ?, contract_price = ?, term_years = ?, interest_rate_bp = ?, reservation_fee = ?,
             payment_interval_months = ?
           WHERE id = ?`,
          [values.name, values.bedrooms, values.bathrooms, values.floor_area, values.monthly_rent, values.status,
            values.listing_type, values.contract_price, values.term_years, values.interest_rate_bp, values.reservation_fee,
            values.payment_interval_months, unit.id],
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw DUPLICATE_UNIT();
        throw error;
      }
      const updated = await db.get('SELECT * FROM units WHERE id = ?', [unit.id]);
      return { unit: unitJson(updated), message: `${updated.name} updated.` };
    },
    DELETE: async (req) => {
      const unit = await ownUnit(req);
      await db.run('DELETE FROM units WHERE id = ?', [unit.id]);
      return { message: `${unit.name} deleted.`, property_id: unit.property_id };
    },
  });

  endpoint(router, '/owner/applications/', {
    roles: RUNNERS,
    GET: async (req) => {
      const list = await applicationList(db, RUNS('p'), [req.user.id, req.user.id], String(req.query.status ?? 'pending'),
        { allFirst: false });
      return {
        status: list.status,
        status_tabs: list.status_tabs,
        applications: list.rows.map((a) => applicationJson(a, { forOwner: true })),
      };
    },
  });

  endpoint(router, '/owner/applications/:id/:decision/', {
    roles: RUNNERS,
    POST: async (req) => {
      const { decision } = req.params;
      if (decision !== 'approve' && decision !== 'reject') throw notFound();
      const applicationId = id(req);
      return db.tx(async (t) => {
        const a = await t.get(`${APPLICATION_SELECT} WHERE a.id = ? AND ${RUNS('p')}`,
          [applicationId, req.user.id, req.user.id]);
        if (!a) throw notFound();
        const tenantName = displayName(tenantOf(a));
        const notPending = () => fail('Only pending applications can be approved or rejected.');
        if (a.status !== 'pending') throw notPending();
        const now = nowIso();

        if (decision === 'reject') {
          const { changes } = await t.run(
            "UPDATE applications SET status = 'rejected', updated_at = ? WHERE id = ? AND status = 'pending'", [now, a.id]);
          if (!changes) throw notPending();
          await notify(t, a.tenant_id, 'application',
            `Your application for ${a.property_name} ${a.unit_name} was not approved.`, '/applications');
          return { message: `${tenantName}'s application for ${a.unit_name} rejected.` };
        }

        // Each update only applies if the row is still in the expected state, so two
        // approvals at the same moment can't both succeed.
        const occupied = await t.run("UPDATE units SET status = 'occupied' WHERE id = ? AND status = 'vacant'", [a.unit_id]);
        if (!occupied.changes) {
          throw fail(`${a.unit_name} is already occupied. Mark it vacant first, or reject this application.`);
        }
        const approved = await t.run(
          "UPDATE applications SET status = 'approved', approved_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
          [now, now, a.id]);
        if (!approved.changes) throw notPending();
        // The approval creates the lease from the unit's current terms (rent: 12 months; rent-to-own: the contract term).
        const unitRow = await t.get('SELECT * FROM units WHERE id = ?', [a.unit_id]);
        await createLease(t, { id: a.id, approved_at: now, preferred_move_in: a.preferred_move_in }, unitRow);
        await notify(t, a.tenant_id, 'application',
          `Your application for ${a.property_name} ${a.unit_name} was approved! Your lease and rent are on the Rent & Payments page.`, '/payments');
        // The unit is taken now, so every other pending application for it is rejected.
        const others = await t.all("SELECT tenant_id FROM applications WHERE unit_id = ? AND status = 'pending' AND id <> ?",
          [a.unit_id, a.id]);
        await notify(t, others.map((o) => o.tenant_id), 'application',
          `Your application for ${a.property_name} ${a.unit_name} was not approved: the unit has been rented.`, '/applications');
        const { changes: rejected } = await t.run(
          "UPDATE applications SET status = 'rejected', updated_at = ? WHERE unit_id = ? AND status = 'pending' AND id <> ?",
          [now, a.unit_id, a.id]);
        const note = rejected
          ? ` ${rejected} other pending application${rejected !== 1 ? 's were' : ' was'} rejected.`
          : '';
        return { message: `${tenantName} approved for ${a.unit_name}. The unit is now marked occupied.${note}` };
      });
    },
  });

  return router;
}
