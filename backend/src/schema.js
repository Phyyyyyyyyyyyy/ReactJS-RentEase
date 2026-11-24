/**
 * Database tables. The same SQL works on SQLite and PostgreSQL; the few
 * differences are filled in from TYPES below.
 *
 * Money is stored as whole centavos (8500.00 pesos = 850000) so no rounding
 * errors creep in. Dates are 'YYYY-MM-DD' text and timestamps are ISO 8601 UTC
 * text, which sort correctly as plain strings. Booleans are 0/1.
 */

const TYPES = {
  sqlite: { ID: 'INTEGER PRIMARY KEY AUTOINCREMENT', REF: 'INTEGER', MONEY: 'INTEGER' },
  postgres: { ID: 'BIGSERIAL PRIMARY KEY', REF: 'BIGINT', MONEY: 'BIGINT' },
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id {ID},
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  password TEXT NOT NULL,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'tenant',
  phone TEXT NOT NULL DEFAULT '',
  profile_photo TEXT NOT NULL DEFAULT '',
  gcash_name TEXT NOT NULL DEFAULT '',
  gcash_number TEXT NOT NULL DEFAULT '',
  gcash_qr TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  date_joined TEXT NOT NULL,
  last_login TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (LOWER(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id {REF} NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS properties (
  id {ID},
  owner_id {REF} NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  property_type TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amenities TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS unique_property_per_owner_address
  ON properties (owner_id, LOWER(name), LOWER(address), LOWER(city));

CREATE TABLE IF NOT EXISTS units (
  id {ID},
  property_id {REF} NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bedrooms INTEGER NOT NULL DEFAULT 0,
  bathrooms INTEGER NOT NULL DEFAULT 1,
  floor_area INTEGER NOT NULL DEFAULT 0,
  monthly_rent {MONEY} NOT NULL,
  status TEXT NOT NULL DEFAULT 'vacant'
);
CREATE UNIQUE INDEX IF NOT EXISTS unique_unit_name_per_property ON units (property_id, LOWER(name));

CREATE TABLE IF NOT EXISTS applications (
  id {ID},
  tenant_id {REF} NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  unit_id {REF} NOT NULL REFERENCES units (id) ON DELETE CASCADE,
  message TEXT NOT NULL DEFAULT '',
  preferred_move_in TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT
);
-- A tenant can have only one pending application per unit.
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_application_per_tenant_unit
  ON applications (tenant_id, unit_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS applications_unit ON applications (unit_id);

CREATE TABLE IF NOT EXISTS rent_charges (
  id {ID},
  tenancy_id {REF} NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  amount {MONEY} NOT NULL,
  due_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_rent_charge_per_tenancy_month ON rent_charges (tenancy_id, period);

CREATE TABLE IF NOT EXISTS payments (
  id {ID},
  tenancy_id {REF} NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  amount {MONEY} NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL,
  reference_number TEXT NOT NULL DEFAULT '',
  proof TEXT NOT NULL DEFAULT '',
  paid_on TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  recorded_by_id {REF} REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at TEXT,
  owner_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_tenancy ON payments (tenancy_id);
-- The same GCash transfer cannot be submitted twice (unless it was rejected).
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_gcash_reference
  ON payments (reference_number) WHERE method = 'gcash' AND reference_number <> '' AND status <> 'rejected';
`;

/**
 * Supabase publishes every table in the `public` schema through its Data API
 * (PostgREST) to the `anon` and `authenticated` roles. RentEase never uses that
 * API; the server connects to PostgreSQL directly. So enable Row Level Security
 * on every table (no policies = the Data API sees no rows) and revoke those
 * roles' privileges. Runs after every start, so new tables are covered too.
 */
const SUPABASE_LOCKDOWN = `
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
  END IF;
END
$$;
`;

export function schemaSql(dialect) {
  const types = TYPES[dialect];
  const sql = SCHEMA.replace(/\{(\w+)\}/g, (_, name) => types[name]);
  return dialect === 'postgres' ? sql + SUPABASE_LOCKDOWN : sql;
}
