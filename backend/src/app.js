/**
 * The Express app: the JSON API under /api, uploaded files under /media, and
 * (once `npm run build` has been run in frontend/) the React app itself.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { csrfProtection, loadUser } from './lib/auth.js';
import { apiErrorHandler, notFound } from './lib/http.js';
import accountsRoutes from './routes/accounts.js';
import adminRoutes from './routes/admin.js';
import paymentsRoutes from './routes/payments.js';
import propertiesRoutes from './routes/properties.js';

export function createApp(db, { mediaDir = config.mediaDir, frontendDist = config.frontendDist } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');

  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
    next();
  });

  // ------------------------------------------------------------------- API
  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));
  api.use(express.urlencoded({ extended: false, limit: '1mb' }));
  api.use(loadUser(db));
  api.use(csrfProtection);
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(accountsRoutes(db, { mediaDir }));
  api.use(propertiesRoutes(db));
  api.use(paymentsRoutes(db, { mediaDir }));
  api.use(adminRoutes(db));
  api.use(() => { throw notFound(); });
  api.use(apiErrorHandler);
  app.use('/api', api);

  // ---------------------------------------------------- uploaded images
  app.use('/media', express.static(mediaDir, { index: false, dotfiles: 'deny', fallthrough: false }));

  // --------------------------------------------------- the built React app
  const index = path.join(frontendDist, 'index.html');
  app.use(express.static(frontendDist, { index: false }));
  // Every other URL is a page of the React app; React Router shows the right one.
  app.get('/{*path}', (req, res) => {
    if (existsSync(index)) {
      res.sendFile(index);
    } else {
      res.status(503).type('text').send(
        'The React app has not been built yet. Run "npm run build" in frontend/, '
        + 'or use the dev server: "npm run dev" in frontend/ and open http://localhost:5173/.',
      );
    }
  });

  return app;
}
