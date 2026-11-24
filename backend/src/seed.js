/**
 * Demo data: one account per role, three sample properties with units, and one
 * pending application. Skips anything that already exists, so it is safe to run
 * again. Used by `npm run seed` and by the server when SEED_DEMO_DATA=true.
 */
import { nowIso } from './lib/format.js';
import { createUser, ROLE_LABEL } from './users.js';

export const DEMO_PASSWORD = 'RentEase@2026';

const DEMO_USERS = [
  ['admin', 'admin@rentease.local', 'System', 'Administrator', 'admin', '0917 000 0001'],
  ['owner', 'owner@rentease.local', 'Maria', 'Santos', 'owner', '0917 000 0002'],
  ['tenant', 'tenant@rentease.local', 'Juan', 'Dela Cruz', 'tenant', '0917 000 0003'],
  ['staff', 'staff@rentease.local', 'Ana', 'Reyes', 'staff', '0917 000 0004'],
];

const V = 'vacant';
const O = 'occupied';
const DEMO_PROPERTIES = [
  {
    name: 'Cebu City Residences', property_type: 'apartment', address: 'Salinas Drive, Lahug', city: 'Cebu City',
    description: 'Accessible apartment property near schools, offices, and public transportation.',
    amenities: 'Wi-Fi Ready, Parking, CCTV',
    units: [['Unit 101', 1, 1, 28, 8500, V], ['Unit 102', 1, 1, 28, 8500, O], ['Unit 201', 2, 1, 40, 12000, V]],
  },
  {
    name: 'Banilad Townhomes', property_type: 'townhouse', address: 'Gov. M. Cuenco Avenue, Banilad', city: 'Cebu City',
    description: 'Quiet residential units with practical access to commercial areas and transport routes.',
    amenities: 'Parking, Pet Friendly, Water Included',
    units: [['Townhome A', 2, 2, 68, 18000, V], ['Townhome B', 2, 2, 70, 18500, V]],
  },
  {
    name: 'Mabolo Studio Hub', property_type: 'studio', address: 'M.J. Cuenco Avenue, Mabolo', city: 'Cebu City',
    description: 'Compact studio units intended for students and young professionals.',
    amenities: 'Wi-Fi Ready, CCTV',
    units: [['Studio 3A', 0, 1, 20, 7000, O], ['Studio 3B', 0, 1, 21, 7200, V]],
  },
];

export async function seedUsers(db, password = DEMO_PASSWORD, log = console.log) {
  for (const [username, email, first, last, role, phone] of DEMO_USERS) {
    if (await db.get('SELECT 1 AS x FROM users WHERE LOWER(username) = LOWER(?)', [username])) {
      log(`  skip   ${username} (already exists)`);
      continue;
    }
    await createUser(db, { username, email, password, first_name: first, last_name: last, role, phone });
    log(`  create ${username} (${ROLE_LABEL[role]})`);
  }
  log(`Demo password: ${password}`);
}

export async function seedProperties(db, password = DEMO_PASSWORD, log = console.log) {
  if (!await db.get("SELECT 1 AS x FROM users WHERE username = 'owner'")) await seedUsers(db, password, log);
  const owner = await db.get("SELECT id FROM users WHERE username = 'owner'");

  for (const { units, ...data } of DEMO_PROPERTIES) {
    if (await db.get('SELECT 1 AS x FROM properties WHERE name = ?', [data.name])) {
      log(`  skip   ${data.name} (already exists)`);
      continue;
    }
    await db.tx(async (t) => {
      const propertyId = await t.insert(
        `INSERT INTO properties (owner_id, name, property_type, address, city, description, amenities, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [owner.id, data.name, data.property_type, data.address, data.city, data.description, data.amenities, nowIso()],
      );
      for (const [name, beds, baths, area, rent, status] of units) {
        await t.insert(
          `INSERT INTO units (property_id, name, bedrooms, bathrooms, floor_area, monthly_rent, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [propertyId, name, beds, baths, area, rent * 100, status],
        );
      }
    });
    log(`  create ${data.name} (${units.length} units)`);
  }

  const tenant = await db.get("SELECT id FROM users WHERE username = 'tenant'");
  const unit = await db.get(
    `SELECT u.id FROM units u JOIN properties p ON p.id = u.property_id
     WHERE p.name = 'Cebu City Residences' AND u.name = 'Unit 201'`,
  );
  if (tenant && unit && !await db.get('SELECT 1 AS x FROM applications WHERE tenant_id = ? AND unit_id = ?', [tenant.id, unit.id])) {
    const now = nowIso();
    await db.insert(
      `INSERT INTO applications (tenant_id, unit_id, message, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
      [tenant.id, unit.id, 'I am interested in the two-bedroom unit and can move in next month.', now, now],
    );
    log('  create pending application for tenant → Unit 201');
  }
}
