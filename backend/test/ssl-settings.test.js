import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { sslSettings } from '../src/db.js';

const POOLER = 'postgresql://postgres.abc:secret123@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';
afterEach(() => { delete process.env.DATABASE_CA_CERT; });

describe('database TLS settings', () => {
  it('encrypts Supabase connections without needing Supabase’s CA (avoids "self-signed certificate")', () => {
    const s = sslSettings(new URL(POOLER), false);
    assert.deepEqual(s.ssl, { rejectUnauthorized: false });
  });

  it('drops sslmode from the URI so it can’t switch strict checking back on', () => {
    const s = sslSettings(new URL(`${POOLER}?sslmode=require`), false);
    assert.equal(new URL(s.connectionString).searchParams.get('sslmode'), null);
    assert.deepEqual(s.ssl, { rejectUnauthorized: false });
  });

  it('verifies the certificate when DATABASE_CA_CERT is set', () => {
    process.env.DATABASE_CA_CERT = '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----';
    const s = sslSettings(new URL(POOLER), false);
    assert.equal(s.ssl.rejectUnauthorized, true);
    assert.equal(s.ssl.ca, '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----');
  });

  it('leaves verify-full with sslrootcert in the URI to pg', () => {
    const url = `${POOLER}?sslmode=verify-full&sslrootcert=/etc/secrets/supabase.crt`;
    const s = sslSettings(new URL(url), false);
    assert.equal(s.ssl, undefined);
    assert.equal(s.connectionString, url);
  });

  it('uses no TLS for a local database', () => {
    assert.equal(sslSettings(new URL('postgresql://me:pw@localhost:5432/rentease'), true).ssl, false);
  });
});
