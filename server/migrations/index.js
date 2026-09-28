// Public migration interface. Application startup verifies; only the CLI applies DDL.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';

const versions = ['000-community', '001-account-chat'];
async function definitions() {
  return Promise.all(versions.map(async version => {
    const sql = await readFile(new URL(version + '.sql', import.meta.url), 'utf8');
    return { version, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}
export async function verifySchema(db) {
  const [rows] = await db.query('SELECT version,checksum,state FROM schema_migrations');
  for (const migration of await definitions()) {
    const saved = rows.find(row => row.version === migration.version);
    if (!saved || saved.checksum !== migration.checksum || saved.state !== 'complete') throw new Error('schemaMigrationRequired');
  }
}
export async function migrate(databaseUrl) {
  const db = await mysql.createConnection({ uri: databaseUrl, timezone: 'Z' });
  try {
    const [[lock]] = await db.query("SELECT GET_LOCK('lavamilk_schema_migrations', 30) AS acquired");
    if (lock.acquired !== 1) throw new Error('Migration lock unavailable');
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      state ENUM('applying','complete') NOT NULL,
      applied_at DATETIME(6) NULL) ENGINE=InnoDB`);
    for (const migration of await definitions()) {
      const [[saved]] = await db.execute('SELECT checksum,state FROM schema_migrations WHERE version=?', [migration.version]);
      if (saved) {
        if (saved.checksum !== migration.checksum || saved.state !== 'complete') throw new Error('Partial or changed migration requires operator review: ' + migration.version);
        continue;
      }
      if (migration.version === '001-account-chat') {
        const [[column]] = await db.query("SHOW FULL COLUMNS FROM community_users LIKE 'github_id'");
        if (column.Type !== 'varchar(24)' || column.Collation !== 'utf8mb4_0900_ai_ci') throw new Error('Unexpected GitHub identity column type/collation');
      }
      await db.execute("INSERT INTO schema_migrations (version,checksum,state) VALUES (?,?,'applying')", [migration.version, migration.checksum]);
      for (const sql of migration.sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await db.query(sql);
      await db.execute("UPDATE schema_migrations SET state='complete',applied_at=UTC_TIMESTAMP(6) WHERE version=?", [migration.version]);
    }
    await verifySchema(db);
  } finally { await db.end(); }
}
