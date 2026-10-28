import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';

async function definitions() {
  return Promise.all(['000-community', '001-account-chat'].map(async version => {
    const sql = await readFile(new URL('../postgres/' + version + '.sql', import.meta.url), 'utf8');
    return { version, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}

export async function verifyPostgresSchema(db) {
  const { rows } = await db.query('SELECT version,checksum,state FROM schema_migrations');
  for (const migration of await definitions()) {
    const saved = rows.find(row => row.version === migration.version);
    if (!saved || saved.checksum !== migration.checksum || saved.state !== 'complete') throw new Error('schemaMigrationRequired');
  }
}

async function connect(url) {
  const db = new pg.Client({ connectionString: url, options: '-c timezone=UTC', connectionTimeoutMillis: 10000 });
  try { await db.connect(); return db; } catch (error) { await db.end(); throw error; }
}

export async function checkPostgresSchema(url) {
  const db = await connect(url);
  try { await verifyPostgresSchema(db); } finally { await db.end(); }
}

export async function migratePostgres(url) {
  const db = await connect(url);
  try {
    await db.query('BEGIN');
    await db.query("SET LOCAL lock_timeout = '30s'");
    await db.query('SELECT pg_advisory_xact_lock(741823956)');
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version varchar(80) PRIMARY KEY, checksum char(64) NOT NULL,
      state varchar(16) NOT NULL CHECK (state IN ('applying','complete')),
      applied_at timestamptz)`);
    for (const migration of await definitions()) {
      const { rows: [saved] } = await db.query('SELECT checksum,state FROM schema_migrations WHERE version=$1', [migration.version]);
      if (saved) {
        if (saved.checksum !== migration.checksum || saved.state !== 'complete') throw new Error('Partial or changed migration requires operator review: ' + migration.version);
        continue;
      }
      // PostgreSQL DDL and the migration ledger commit together, or roll back together.
      await db.query(migration.sql);
      await db.query("INSERT INTO schema_migrations VALUES ($1,$2,'complete',clock_timestamp())", [migration.version,migration.checksum]);
    }
    await verifyPostgresSchema(db);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { await db.end(); }
}
