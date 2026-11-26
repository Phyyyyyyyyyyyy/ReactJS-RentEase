/**
 * Check the database connection: `npm run db:check` (in backend/).
 *
 * Uses the same settings as the app (DATABASE_URL in the environment or
 * backend/.env; without it, the local SQLite file). Prints which database it
 * reached, how long it took, the tables, and how many accounts exist.
 * Never prints the password.
 */
import { config } from '../src/config.js';
import { openDatabase } from '../src/db.js';

const started = Date.now();
let where = `SQLite file ${config.sqlitePath}`;
if (config.databaseUrl) {
  try {
    const u = new URL(config.databaseUrl.trim());
    where = `PostgreSQL ${u.hostname}:${u.port || 5432} (user ${decodeURIComponent(u.username)})`;
  } catch {
    where = 'PostgreSQL (DATABASE_URL is not a valid URL)';
  }
}
console.log(`Database: ${where}`);

try {
  const db = await openDatabase();
  const tables = db.dialect === 'postgres'
    ? await db.all("SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")
    : await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const users = await db.all('SELECT role, COUNT(*) AS n FROM users GROUP BY role ORDER BY role');
  console.log(`OK: connected in ${Date.now() - started} ms`);
  console.log(`Tables (${tables.length}): ${tables.map((t) => t.name).join(', ')}`);
  console.log(`Accounts: ${users.length ? users.map((u) => `${u.n} ${u.role}`).join(', ') : 'none yet'}`);
  if (db.dialect === 'postgres') {
    const open = await db.all(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`);
    console.log(`Row Level Security: ${open.length ? `OFF on ${open.map((t) => t.name).join(', ')}` : 'on for every table'}`);
  }
  await db.close();
} catch (error) {
  console.error(`FAILED: ${error.message.split('\n')[0]}`);
  process.exit(1);
}
