/** Start the RentEase API server: `npm start` (or `npm run dev` to restart on code changes). */
import { createApp } from './app.js';
import { config } from './config.js';
import { openDatabase } from './db.js';
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

const app = createApp(db);
const verifiedSenderService = (config.mailjetApiKey && config.mailjetSecretKey && 'Mailjet') || (config.brevoApiKey && 'Brevo');
if (verifiedSenderService) {
  if (!config.emailFrom) {
    console.warn(`WARNING: ${verifiedSenderService} is set up but EMAIL_FROM is not. Set EMAIL_FROM to the sender you verified in ${verifiedSenderService}, e.g. "RentEase <you@gmail.com>".`);
  } else {
    console.log(`Emails are sent with ${verifiedSenderService} from ${config.emailFrom}.`);
  }
} else if (config.resendApiKey) {
  console.log('Emails are sent with Resend.');
} else {
  console.warn('Note: no email service is set up (BREVO_API_KEY or RESEND_API_KEY), so verification emails are printed in this log instead of sent.');
}

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
