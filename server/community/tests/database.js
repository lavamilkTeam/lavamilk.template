import mysql from 'mysql2/promise';
import pg from 'pg';

// Test fixtures use only portable SQL, with '?' parameters. Production adapters
// use each driver's native API and SQL; this helper is never imported by them.
export async function connectTestDatabase(url) {
  if (new URL(url).protocol === 'mysql:') return mysql.createConnection({ uri: url, timezone: 'Z' });
  const db = new pg.Client({ connectionString: url, options: '-c timezone=UTC' });
  await db.connect();
  return {
    async execute(sql, parameters = []) {
      let index = 0;
      const result = await db.query(sql.replace(/\?/g, () => '$' + (++index)), parameters);
      return [result.rows];
    },
    end: () => db.end(),
  };
}
