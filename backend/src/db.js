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
    + 'Copy it from Supabase (Connect > Session pooler) and put your database password in place of [YOUR-PASSWORD], '
    + 'without the square brackets.',
  );
  if (!/^postgres(ql)?:\/\//.test(url)) throw problem('it must start with postgresql://');
  if (/\[YOUR-PASSWORD\]/i.test(url)) throw problem('it still contains [YOUR-PASSWORD].');
  const specialCharacters = problem('it could not be read. If your password contains @ # / ? : % or spaces, '
    + 'reset it in Supabase to letters and numbers only, or replace those characters with %40 %23 %2F %3F %3A %25 %20.');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw specialCharacters;
  }
  // A # or ? in the password cuts the URL short; a / moves the host into the path.
  if (parsed.hash || !/^\/[^/]*$/.test(parsed.pathname) || !parsed.port) throw specialCharacters;
  if (!parsed.password) throw problem('it has no password.');
  if (/^\[.*\]$/.test(decodeURIComponent(parsed.password))) throw problem('remove the square brackets around your password.');
  if (!parsed.hostname) throw problem('it has no host name.');
  if (/^db\.[a-z0-9]+\.supabase\.co$/i.test(parsed.hostname)) {
    throw problem('this is Supabase\'s "Direct connection" (db.<project>.supabase.co), which only works over IPv6, '
      + 'and hosts like Render can\'t reach it. In Supabase click Connect and choose Method: Session pooler '
      + '(the host ends in pooler.supabase.com).');
  }
}

class PostgresDatabase {
  dialect = 'postgres';

  static async connect(url) {
    checkDatabaseUrl(url);
    const { default: pg } = await import('pg');
    // COUNT() and SUM() come back as strings by default; the numbers here fit in a JS number.
    pg.types.setTypeParser(20, Number); // bigint
    pg.types.setTypeParser(1700, Number); // numeric
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || /sslmode=disable/.test(url);
    const pool = new pg.Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 10 });
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
    try {
      await client.query('BEGIN');
      const result = await fn(PostgresDatabase.scope(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async migrate() {
    await this.pool.query(schemaSql('postgres'));
    for (const { table, column, type, fill } of ADDED_COLUMNS) {
      const { rowCount } = await this.pool.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
        [table, column],
      );
      if (!rowCount) {
        await this.pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${columnType(type, 'postgres')};${fill ? ` ${fill};` : ''}`);
      }
    }
    for (const sql of DATA_MIGRATIONS) await this.pool.query(sql);
  }

  async close() {
    await this.pool.end();
  }
}

/** Open the database (PostgreSQL if a URL is given, else SQLite) and create any missing tables. */
export async function openDatabase({ url = config.databaseUrl, sqlitePath = config.sqlitePath } = {}) {
  url = cleanDatabaseUrl(url);
  const db = url ? await PostgresDatabase.connect(url) : new SqliteDatabase(sqlitePath);
  await db.migrate();
  return db;
}
