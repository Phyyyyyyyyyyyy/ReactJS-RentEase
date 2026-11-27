/**
 * Settings, read from environment variables and the optional backend/.env file
 * (see .env.example). Never commit the real .env.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .env files, in order: backend/.env (local development), then the repo root and
// /etc/secrets, where Render puts a "Secret File" named .env. Variables already
// set in the environment win, and an earlier file wins over a later one.
export const ENV_FILES = [
  path.join(BACKEND_DIR, '.env'),
  path.join(BACKEND_DIR, '..', '.env'),
  '/etc/secrets/.env',
].filter((file) => existsSync(file));
for (const file of ENV_FILES) process.loadEnvFile(file);

function list(value, fallback) {
  return (value ?? fallback).split(',').map((s) => s.trim()).filter(Boolean);
}

function flag(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes'].includes(String(value).toLowerCase());
}

// Render sets RENDER=true. There the app sits behind Render's HTTPS proxy and
// must listen on every network interface, so those settings switch on by themselves.
export const ON_RENDER = flag(process.env.RENDER);

export const config = {
  host: process.env.HOST || (ON_RENDER ? '0.0.0.0' : '127.0.0.1'),
  port: Number(process.env.PORT) || 8000,

  // PostgreSQL (Supabase) when DATABASE_URL is set, otherwise a local SQLite file.
  databaseUrl: process.env.DATABASE_URL || '',
  sqlitePath: process.env.SQLITE_PATH || path.join(BACKEND_DIR, 'rentease.sqlite3'),

  // Sites allowed to send requests that change data (the Vite dev server).
  trustedOrigins: list(process.env.CSRF_TRUSTED_ORIGINS, 'http://localhost:5173,http://127.0.0.1:5173'),
  // Set COOKIE_SECURE=true when the site is served over HTTPS (on by default on Render).
  secureCookies: flag(process.env.COOKIE_SECURE, ON_RENDER),

  // When deployed behind a proxy (e.g. a hosting platform), set TRUST_PROXY=1 so
  // sign-in limits count each visitor's real address instead of the proxy's (1 by default on Render).
  trustProxy: Number(process.env.TRUST_PROXY ?? (ON_RENDER ? 1 : 0)) || 0,

  // Create the demo accounts and properties on startup if they don't exist yet
    // Real GCash payments through PayMongo. Without PAYMONGO_SECRET_KEY the app uses the
  // sandbox (practice) checkout instead. Keep the secret key on the server only.
  paymongo: {
    secretKey: process.env.PAYMONGO_SECRET_KEY || '',
    webhookSecret: process.env.PAYMONGO_WEBHOOK_SECRET || '',
    paymentMethods: list(process.env.PAYMONGO_PAYMENT_METHODS, 'gcash'),
  },
  // Where PayMongo sends the tenant back after paying. Render sets RENDER_EXTERNAL_URL itself.
  publicAppUrl: (process.env.PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173').replace(/\/+$/, ''),





  // (useful where there's no shell to run `npm run seed`, like Render's free plan).
  seedDemoData: flag(process.env.SEED_DEMO_DATA),

  mediaDir: process.env.MEDIA_DIR || path.join(BACKEND_DIR, 'media'),
  frontendDist: path.resolve(BACKEND_DIR, '..', 'frontend', 'dist'),
};

/** Asia/Manila is UTC+8 all year (no daylight saving time). */
export const TIME_ZONE_OFFSET_MS = 8 * 60 * 60 * 1000;
