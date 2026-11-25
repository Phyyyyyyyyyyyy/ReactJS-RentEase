/** Start the RentEase API server: `npm start` (or `npm run dev` to restart on code changes). */
import { createApp } from './app.js';
import { config } from './config.js';
import { openDatabase } from './db.js';
import { ensureAdmin } from './bootstrap.js';
import { backfillLeases } from './leases.js';
import { DEMO_PASSWORD, seedProperties, seedUsers } from './seed.js';

let db;
try {
  db = await openDatabase();
} catch (error) {
  console.error(`Could not open the database. ${error.message}`);
  process.exit(1);
}

// Approved tenancies from before leases existed get one now.
const added = await backfillLeases(db);
if (added) console.log(`Created ${added} lease${added === 1 ? '' : 's'} for existing tenancies.`);

if (config.seedDemoData) {
  const password = process.env.DEMO_PASSWORD || DEMO_PASSWORD;
  if (password === DEMO_PASSWORD) {
    console.warn('WARNING: demo accounts use the public demo password. Set DEMO_PASSWORD to keep them private.');
  }
  console.log('Creating demo data (SEED_DEMO_DATA=true):');
  await seedUsers(db, password);
  await seedProperties(db, password);
}

// ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD: make sure that admin account exists.
const adminStatus = await ensureAdmin(db, {
  username: process.env.ADMIN_USERNAME, email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD,
});
if (adminStatus) console.log(adminStatus);

const app = createApp(db);

const server = app.listen(config.port, config.host, () => {
  const where = config.databaseUrl ? 'PostgreSQL (DATABASE_URL)' : config.sqlitePath;
  console.log(`RentEase API running at http://${config.host}:${config.port}/  (database: ${where})`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Stop the other server or set PORT in backend/.env.`);
    process.exit(1);
  }
  throw error;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    db.close().finally(() => process.exit(0));
  });
}
