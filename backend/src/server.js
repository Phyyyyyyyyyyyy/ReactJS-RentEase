/** Start the RentEase API server: `npm start` (or `npm run dev` to restart on code changes). */
import { createApp } from './app.js';
import { config } from './config.js';
import { openDatabase } from './db.js';

const db = await openDatabase();
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
