import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDatabaseUrl, cleanDatabaseUrl, openDatabase } from '../src/db.js';

test('accepts Supabase session pooler and direct PostgreSQL URIs', () => {
  const pooler = 'postgresql://postgres.example:demo%40password@aws-0-region.pooler.supabase.com:5432/postgres';
  const direct = 'postgresql://postgres:demo%40password@db.example.supabase.co/postgres';
  assert.equal(checkDatabaseUrl(pooler).port, '5432');
  assert.equal(checkDatabaseUrl(direct).hostname, 'db.example.supabase.co');
  assert.throws(() => checkDatabaseUrl(direct.replace('demo%40password', '[YOUR-PASSWORD]')), /password placeholder/);
  assert.throws(() => checkDatabaseUrl(direct.replace('%40', '%zz')), /URI is malformed/);
});

const url = cleanDatabaseUrl(process.env.TEST_POSTGRES_URL);

test('initializes a fresh PostgreSQL database safely across concurrent starts', { skip: !url }, async (t) => {
  const { default: pg } = await import('pg');
  const control = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  await control.connect();
  t.after(() => control.end());
  const existing = await control.query("SELECT 1 FROM pg_tables WHERE schemaname = 'public' LIMIT 1");
  assert.equal(existing.rowCount, 0, 'TEST_POSTGRES_URL must point to a blank, disposable PostgreSQL database.');

  await control.query('CREATE TABLE public.rentease_test_unrelated (id INTEGER)');
  try {
    await control.query('GRANT SELECT ON TABLE public.rentease_test_unrelated TO PUBLIC');
    const starts = await Promise.allSettled([openDatabase({ url }), openDatabase({ url })]);
    for (const start of starts) {
      if (start.status === 'fulfilled') t.after(() => start.value.close());
    }
    const [writer, reader] = starts.map((start) => {
      if (start.status === 'rejected') throw start.reason;
      return start.value;
    });

    const id = await writer.insert(
      'INSERT INTO users (username, email, password, date_joined) VALUES (?, ?, ?, ?)',
      ['postgres_test', 'postgres_test@example.com', 'unused', '2026-01-01'],
    );
    assert.equal(typeof id, 'number');
    assert.equal((await reader.get('SELECT username FROM users WHERE id = ?', [id])).username, 'postgres_test');

    const tables = await reader.all("SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'");
    assert.ok(tables.some((table) => table.tablename === 'gcash_checkouts'));
    for (const { tablename, rowsecurity } of tables) {
      assert.equal(rowsecurity, tablename !== 'rentease_test_unrelated', tablename);
    }
    const unrelatedGrant = await control.query(`
      SELECT 1 FROM information_schema.table_privileges
      WHERE table_schema = 'public' AND table_name = 'rentease_test_unrelated'
        AND grantee = 'PUBLIC' AND privilege_type = 'SELECT'
    `);
    assert.equal(unrelatedGrant.rowCount, 1);
  } finally {
    await control.query('DROP TABLE public.rentease_test_unrelated');
  }
});
