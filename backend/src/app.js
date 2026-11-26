/**
 * The Express app: the JSON API under /api, uploaded files under /media, and
 * (once `npm run build` has been run in frontend/) the React app itself.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { csrfProtection, loadUser } from './lib/auth.js';
import { apiErrorHandler, notFound } from './lib/http.js';
import accountsRoutes, { DEFAULT_LIMITS } from './routes/accounts.js';
import { defaultGateway } from './gcash.js';
import adminRoutes from './routes/admin.js';
import referralsRoutes from './routes/referrals.js';
import financesRoutes from './routes/finances.js';
import gcashRoutes from './routes/gcash.js';
import statementsRoutes from './routes/statements.js';
import unitLogsRoutes from './routes/unitLogs.js';
import leasesRoutes from './routes/leases.js';
import notificationsRoutes from './routes/notifications.js';
import paymentsRoutes from './routes/payments.js';
import propertiesRoutes from './routes/properties.js';

/**
 * Content-Security-Policy for the React app: the browser may only run scripts
 * from this site (plus the page's own inline theme script, allowed by its
 * hash), so text someone types, like a username, can never run as code.
 */
function contentSecurityPolicy(html) {
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(([, code]) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`);
  return [
    "default-src 'self'",
    `script-src 'self' ${inline.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function createApp(db, {
  mediaDir = config.mediaDir, frontendDist = config.frontendDist, limits, gateway = defaultGateway(),
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  // Behind a hosting proxy, use the visitor's real address (for sign-in limits).
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

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
  api.use(accountsRoutes(db, { mediaDir, limits: { ...DEFAULT_LIMITS, ...limits } }));
  api.use(referralsRoutes(db));
  api.use(propertiesRoutes(db));
  api.use(paymentsRoutes(db, { mediaDir }));
  api.use(gcashRoutes(db, { gateway }));
  api.use(statementsRoutes(db));
  api.use(unitLogsRoutes(db));
  api.use(leasesRoutes(db));
  api.use(financesRoutes(db));
  api.use(notificationsRoutes(db));
  api.use(adminRoutes(db));
  api.use(() => { throw notFound(); });
  api.use(apiErrorHandler);
  app.use('/api', api);

  // ---------------------------------------------------- uploaded images
  app.use('/media', express.static(mediaDir, { index: false, dotfiles: 'deny', fallthrough: false }));
  // Missing files and blocked paths (like /media/../) are a plain 404.
  app.use('/media', (error, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(404).type('text').send('Not found');
  });

  // --------------------------------------------------- the built React app
  const index = path.join(frontendDist, 'index.html');
  app.use(express.static(frontendDist, { index: false }));
  // Every other URL is a page of the React app; React Router shows the right one.
  app.get('/{*path}', (req, res) => {
    if (existsSync(index)) {
      const html = readFileSync(index, 'utf8');
      res.set('Content-Security-Policy', contentSecurityPolicy(html)).type('html').send(html);
    } else {
      res.status(503).type('text').send(
        'The React app has not been built yet. Run "npm run build" in frontend/, '
        + 'or use the dev server: "npm run dev" in frontend/ and open http://localhost:5173/.',
      );
    }
  });

  return app;
}
