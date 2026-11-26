/**
 * A small database layer with the same async API for SQLite and PostgreSQL:
 *
 *   await db.all(sql, params)     -> array of rows
 *   await db.get(sql, params)     -> first row or undefined
 *   await db.run(sql, params)     -> { changes }
 *   await db.insert(sql, params)  -> id of the new row
 *   await db.tx(async (t) => ...) -> runs everything on `t` in one transaction
 *
 * SQL is written with `?` placeholders; they are converted to $1, $2... for PostgreSQL.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { ADDED_COLUMNS, columnType, DATA_MIGRATIONS, schemaSql } from './schema.js';

function normalize(params) {
  return params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
}

/** True when `error` is a UNIQUE constraint violation (in either database). */
export function isUniqueViolation(error) {
  return error?.code === '23505' || /UNIQUE constraint failed/.test(error?.message || '');
}

class SqliteDatabase {
  dialect = 'sqlite';

  constructor(file) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.conn = new DatabaseSync(file);
    this.conn.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (file !== ':memory:') this.conn.exec('PRAGMA journal_mode = WAL;');
    this.statements = new Map();
    // SQLite has one connection. While a transaction runs, other requests wait
    // so their statements don't end up inside it.
    this.busy = null;
  }

  statement(sql) {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.conn.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  query(sql, params = []) {
    return this.statement(sql).all(...normalize(params));
  }

  execute(sql, params = []) {
    return { changes: Number(this.statement(sql).run(...normalize(params)).changes) };
  }

  async all(sql, params) {
    while (this.busy) await this.busy;
    return this.query(sql, params);
  }

  async get(sql, params) {
    return (await this.all(sql, params))[0];
  }

  async run(sql, params) {
    while (this.busy) await this.busy;
    return this.execute(sql, params);
  }

  async insert(sql, params) {
    return (await this.get(`${sql} RETURNING id`, params)).id;
  }

  async tx(fn) {
    while (this.busy) await this.busy;
    let release;
    this.busy = new Promise((resolve) => { release = resolve; });
    const scope = {
      dialect: this.dialect,
      all: async (sql, params) => this.query(sql, params),
      get: async (sql, params) => this.query(sql, params)[0],
      run: async (sql, params) => this.execute(sql, params),
      insert: async (sql, params) => this.query(`${sql} RETURNING id`, params)[0].id,
      tx: (inner) => inner(scope),
    };
    this.conn.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn(scope);
      this.conn.exec('COMMIT');
      return result;
    } catch (error) {
      this.conn.exec('ROLLBACK');
      throw error;
    } finally {
      this.busy = null;
      release();
    }
  }

  async migrate() {
    this.conn.exec(schemaSql('sqlite'));
    for (const { table, column, type, fill } of ADDED_COLUMNS) {
      const columns = this.conn.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      if (!columns.includes(column)) {
        this.conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${columnType(type, 'sqlite')};${fill ? ` ${fill};` : ''}`);
      }
    }
    for (const sql of DATA_MIGRATIONS) this.conn.exec(sql);
  }

  async close() {
    this.conn.close();
  }
}

/** Remove spaces, line breaks, and quotes that often sneak in when pasting a URL. */
export function cleanDatabaseUrl(url) {
  return String(url || '').trim().replace(/^(['"])(.*)\1$/s, '$2').trim();
}

/**
 * Explain a broken DATABASE_URL clearly, without printing it (it contains the password).
 */
export function checkDatabaseUrl(url) {
  const problem = (reason) => new Error(
    `DATABASE_URL is not a valid PostgreSQL connection string: ${reason}\n`
    + 'Copy the URI from Supabase (Connect > Session pooler) and URL-encode reserved characters in the database password.',
  );
  if (!/^postgres(?:ql)?:\/\//.test(url)) throw problem('it must start with postgresql://');
  if (/\[YOUR-(?:DATABASE-)?PASSWORD\]/i.test(url)) throw problem('replace the database password placeholder.');

  let parsed;
  try {
    parsed = new URL(url);
    decodeURIComponent(parsed.href); // Reject malformed percent escapes before handing the URI to pg.
  } catch {
    throw problem('the URI is malformed.');
  }
  if (parsed.hash || !parsed.hostname || !parsed.username || !/^\/[^/]+$/.test(parsed.pathname)) {
    throw problem('include the database user, host, and name without a URL fragment.');
  }
  if (!parsed.password) throw problem('it has no database password.');
  return parsed;
}

/**
 * TLS for remote databases. Connections are always encrypted. The server's
 * certificate is verified when a CA is supplied:
 *   - DATABASE_CA_CERT: the CA certificate's PEM text (e.g. Supabase's, from
 *     Project Settings > Database > SSL), handy on hosts like Render; or
 *   - sslmode=verify-full / verify-ca with sslrootcert=<file> in the URI.
 * Without one, the certificate isn't checked against public CAs, because
 * Supabase's pooler uses its own CA that Node doesn't know and every connection
 * would fail with "self-signed certificate in certificate chain".
 */
export function sslSettings(uri, local) {
  if (local) return { connectionString: uri.href, ssl: false };
  const ca = process.env.DATABASE_CA_CERT;
  if (ca && ca.trim()) {
    return { connectionString: uri.href, ssl: { ca: ca.replace(/\\n/g, '\n'), rejectUnauthorized: true } };
  }
  const mode = uri.searchParams.get('sslmode');
  if (uri.searchParams.get('sslrootcert') && (mode === 'verify-full' || mode === 'verify-ca')) {
    return { connectionString: uri.href }; // pg reads the CA file and verifies
  }
  // SSL options in the URI would override the setting below, so they're removed here.
  const plain = new URL(uri.href);
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl', 'uselibpqcompat']) plain.searchParams.delete(key);
  return { connectionString: plain.href, ssl: { rejectUnauthorized: false } };
}

class PostgresDatabase {
  dialect = 'postgres';

  static async connect(url) {
    const uri = checkDatabaseUrl(url);
    const { default: pg } = await import('pg');
    // COUNT() and SUM() come back as strings by default; the numbers here fit in a JS number.
    pg.types.setTypeParser(20, Number); // bigint
    pg.types.setTypeParser(1700, Number); // numeric
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname.toLowerCase());
    const pool = new pg.Pool({
      ...sslSettings(uri, local),
      connectionTimeoutMillis: 10_000,
      max: 10,
    });
    pool.on('error', (error) => console.warn('PostgreSQL idle connection closed.', error.code || error.name));
    return new PostgresDatabase(pool);
  }

  constructor(pool) {
    this.pool = pool;
  }

  static convert(sql) {
    let n = 0;
    return sql.replace(/\?/g, () => `$${++n}`);
  }

  static scope(client) {
    const query = (sql, params = []) => client.query(PostgresDatabase.convert(sql), normalize(params));
    const scope = {
      dialect: 'postgres',
      all: async (sql, params) => (await query(sql, params)).rows,
      get: async (sql, params) => (await query(sql, params)).rows[0],
      run: async (sql, params) => ({ changes: (await query(sql, params)).rowCount }),
      insert: async (sql, params) => (await query(`${sql} RETURNING id`, params)).rows[0].id,
      tx: (inner) => inner(scope),
    };
    return scope;
  }

  all(sql, params) { return PostgresDatabase.scope(this.pool).all(sql, params); }
  get(sql, params) { return PostgresDatabase.scope(this.pool).get(sql, params); }
  run(sql, params) { return PostgresDatabase.scope(this.pool).run(sql, params); }
  insert(sql, params) { return PostgresDatabase.scope(this.pool).insert(sql, params); }

  async tx(fn) {
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
      const result = await fn(PostgresDatabase.scope(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => { discard = true; });
      throw error;
    } finally {
      client.release(discard);
    }
  }

  async migrate() {
    await this.tx(async (t) => {
      // Hold the lock through commit so replicas can safely initialize the same database.
      await t.run("SELECT pg_advisory_xact_lock(hashtext('rentease.schema'))");
      await t.run('SET LOCAL search_path TO public');
      await t.run(schemaSql('postgres'));
      const columns = new Set((await t.all(
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'",
      )).map(({ table_name, column_name }) => `${table_name}.${column_name}`));
      for (const { table, column, type, fill } of ADDED_COLUMNS) {
        if (!columns.has(`${table}.${column}`)) {
          await t.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${columnType(type, 'postgres')}`);
          if (fill) await t.run(fill);
        }
      }
      for (const sql of DATA_MIGRATIONS) await t.run(sql);
    });
  }

  async close() {
    await this.pool.end();
  }
}

/** Open the database (PostgreSQL if a URL is given, else SQLite) and create any missing tables. */
export async function openDatabase({ url = config.databaseUrl, sqlitePath = config.sqlitePath } = {}) {
  url = cleanDatabaseUrl(url);
  const db = url ? await PostgresDatabase.connect(url) : new SqliteDatabase(sqlitePath);
  try {
    await db.migrate();
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
