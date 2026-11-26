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
  last_login TEXT,
  -- The referral code the account signed up with (none for accounts an admin created).
  referral_code_id {REF}
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (LOWER(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id {REF} NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

-- Referral codes: signing up needs one. An admin creates each code for one role;
-- it works any number of times until the admin disables it.
CREATE TABLE IF NOT EXISTS referral_codes (
  id {ID},
  code TEXT NOT NULL,
  role TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by_id {REF} REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_code_unique ON referral_codes (UPPER(code));

CREATE TABLE IF NOT EXISTS properties (
  id {ID},
  owner_id {REF} NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  manager_id {REF} REFERENCES users (id) ON DELETE SET NULL,
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

-- The lease created when an application is approved. Rent is billed monthly
-- from start_date to end_date at monthly_rent. Status: active or terminated
-- (an active lease past its end date counts as expired).
CREATE TABLE IF NOT EXISTS leases (
  id {ID},
  application_id {REF} NOT NULL UNIQUE REFERENCES applications (id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  monthly_rent {MONEY} NOT NULL CHECK (monthly_rent > 0),
  deposit {MONEY} NOT NULL DEFAULT 0 CHECK (deposit >= 0),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  terminated_at TEXT
);

-- Money an owner spends on a property (repairs, utilities, taxes...), for the financial report.
CREATE TABLE IF NOT EXISTS expenses (
  id {ID},
  property_id {REF} NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  amount {MONEY} NOT NULL CHECK (amount > 0),
  spent_on TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS expenses_property ON expenses (property_id, spent_on);

-- Payment logs: the owner's own record of a unit's payments, like a spreadsheet
-- (e.g. a rent-to-own buyer who doesn't use the app). One log per buyer/contract.
CREATE TABLE IF NOT EXISTS unit_logs (
  id {ID},
  unit_id {REF} NOT NULL REFERENCES units (id) ON DELETE CASCADE,
  holder_name TEXT NOT NULL,
  start_date TEXT,
  contract_price {MONEY},
  term_years INTEGER,
  interest_rate_bp INTEGER,
  monthly_amount {MONEY},
  note TEXT NOT NULL DEFAULT '',
  created_by_id {REF} REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS unit_logs_unit ON unit_logs (unit_id);

CREATE TABLE IF NOT EXISTS unit_log_entries (
  id {ID},
  log_id {REF} NOT NULL REFERENCES unit_logs (id) ON DELETE CASCADE,
  entry_date TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount {MONEY} NOT NULL CHECK (amount > 0),
  mode TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS unit_log_entries_log ON unit_log_entries (log_id, entry_date);

-- Online GCash checkouts (sandbox mode for now). id is the random code in the checkout link.
CREATE TABLE IF NOT EXISTS gcash_checkouts (
  id TEXT PRIMARY KEY,
  tenancy_id {REF} NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  tenant_id {REF} NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  amount {MONEY} NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending',
  payment_id {REF} REFERENCES payments (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- In-app notifications. dedupe_key stops the same reminder being sent twice.
CREATE TABLE IF NOT EXISTS notifications (
  id {ID},
  user_id {REF} NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, is_read);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_once ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

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

/**
 * Columns added after the first version. Databases created before them get
 * the column added on startup; `fill` sets the value for the rows already there.
 */
export const ADDED_COLUMNS = [
  {
    table: 'users',
    column: 'referral_code_id',
    type: '{REF}',
  },
  {
    table: 'properties',
    column: 'manager_id',
    type: '{REF} REFERENCES users (id) ON DELETE SET NULL',
  },
  // Rent or rent-to-own, per unit. For rent-to-own, monthly_rent is the monthly
  // payment, and these hold the contract: price, term in years, yearly interest
  // rate in basis points (5% = 500, for reference), and the reservation fee.
  { table: 'units', column: 'listing_type', type: "TEXT NOT NULL DEFAULT 'rent'" },
  { table: 'units', column: 'contract_price', type: '{MONEY}' },
  { table: 'units', column: 'term_years', type: 'INTEGER' },
  { table: 'units', column: 'interest_rate_bp', type: 'INTEGER' },
  { table: 'units', column: 'reservation_fee', type: '{MONEY} NOT NULL DEFAULT 0' },
  // A lease keeps the contract terms it was approved with, even if the unit changes later.
  { table: 'leases', column: 'lease_type', type: "TEXT NOT NULL DEFAULT 'rent'" },
  { table: 'leases', column: 'contract_price', type: '{MONEY}' },
  { table: 'leases', column: 'term_years', type: 'INTEGER' },
  { table: 'leases', column: 'interest_rate_bp', type: 'INTEGER' },
  { table: 'leases', column: 'reservation_fee', type: '{MONEY} NOT NULL DEFAULT 0' },
  // What a payment is for: the monthly payment, the reservation fee, or something else.
  { table: 'payments', column: 'kind', type: "TEXT NOT NULL DEFAULT 'monthly'" },
  // Payment terms: pay every N months (1 = monthly, 2 = every 2 months...). monthly_rent
  // stays the monthly rate; each bill covers N months (N x the monthly rate).
  { table: 'units', column: 'payment_interval_months', type: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'leases', column: 'payment_interval_months', type: 'INTEGER NOT NULL DEFAULT 1' },
  // How many months a bill covers.
  { table: 'rent_charges', column: 'months', type: 'INTEGER NOT NULL DEFAULT 1' },
];

/** Data changes that are safe to run on every start (they do nothing once applied). */
export const DATA_MIGRATIONS = [
  // The Staff role became Property Manager (see the class diagram).
  "UPDATE users SET role = 'manager' WHERE role = 'staff'",
];

/** A column type from ADDED_COLUMNS with {ID}/{REF}/{MONEY} filled in for `dialect`. */
export const columnType = (type, dialect) => type.replace(/\{(\w+)\}/g, (_, name) => TYPES[dialect][name]);

export function schemaSql(dialect) {
  const types = TYPES[dialect];
  const sql = SCHEMA.replace(/\{(\w+)\}/g, (_, name) => types[name]);
  return dialect === 'postgres' ? sql + SUPABASE_LOCKDOWN : sql;
}
