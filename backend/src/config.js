/**
 * Settings, read from environment variables and the optional backend/.env file
 * (see .env.example). Never commit the real .env.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(BACKEND_DIR, '.env');
// Variables already set in the environment win over the file.
if (existsSync(envFile)) process.loadEnvFile(envFile);

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
  // (useful where there's no shell to run `npm run seed`, like Render's free plan).
  seedDemoData: flag(process.env.SEED_DEMO_DATA),

  mediaDir: process.env.MEDIA_DIR || path.join(BACKEND_DIR, 'media'),
  frontendDist: path.resolve(BACKEND_DIR, '..', 'frontend', 'dist'),
};

/** Asia/Manila is UTC+8 all year (no daylight saving time). */
export const TIME_ZONE_OFFSET_MS = 8 * 60 * 60 * 1000;
