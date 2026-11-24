/**
 * Create the demo data (see src/seed.js).
 *
 *   npm run seed                       # users and properties
 *   npm run seed -- users              # only the demo accounts
 *   npm run seed -- --password Secret  # a different password for the demo accounts
 */
import { parseArgs } from 'node:util';
import { openDatabase } from '../src/db.js';
import { seedProperties, seedUsers } from '../src/seed.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { password: { type: 'string' } } });
const what = positionals[0] || 'all';
if (!['all', 'users', 'properties'].includes(what)) {
  console.error('Usage: npm run seed [-- users|properties] [-- --password <password>]');
  process.exit(1);
}

const db = await openDatabase();
try {
  if (what === 'all' || what === 'users') await seedUsers(db, values.password);
  if (what === 'all' || what === 'properties') await seedProperties(db, values.password);
} finally {
  await db.close();
}
