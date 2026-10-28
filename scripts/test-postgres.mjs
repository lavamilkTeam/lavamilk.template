// Isolated PostgreSQL integration tests; never use DATABASE_URL or the local dev DB.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
const require = createRequire(new URL('../server/package.json', import.meta.url));
const { Client } = require('pg');
const name = 'lavamilk-pg-test-' + randomUUID();
let created = false;
let databaseUrl = process.env.TEST_POSTGRES_URL;
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr.trim());
  return result.stdout.trim();
}
try {
  if (!databaseUrl) {
    const password = randomUUID();
    docker(['run', '--detach', '--rm', '--name', name, '-p', '127.0.0.1::5432',
      '-e', 'POSTGRES_PASSWORD=' + password, '-e', 'POSTGRES_DB=lavamilk_test', 'postgres:18-alpine']);
    created = true;
    const port = docker(['port', name, '5432/tcp']).split(':').at(-1);
    databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/lavamilk_test`;
    let ready = false;
    for (let i = 0; i < 60; i++) {
      const db = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 1000 });
      try { await db.connect(); ready = true; break; }
      catch { await delay(1000); }
      finally { await db.end(); }
    }
    if (!ready) throw new Error('Isolated PostgreSQL did not become ready within 60 seconds');
  }
  const parsed = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !/test/i.test(parsed.pathname)) throw new Error('TEST_POSTGRES_URL must name a dedicated PostgreSQL test database');
  const migration = spawnSync(process.execPath, ['server/migrate.js'], { stdio: 'inherit', env: { ...process.env, MIGRATION_DATABASE_URL: databaseUrl } });
  if (migration.status !== 0) throw new Error('Test database migration failed');
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1',
    'server/community/tests/application.test.js', 'server/community/tests/chat-persistence.test.js', 'server/community/tests/postgres.test.js'], {
    stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: databaseUrl },
  });
  process.exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => resolve(code ?? 1)); });
} catch (error) {
  console.error('PostgreSQL integration tests failed:', error.message);
  process.exitCode = 1;
} finally {
  if (created) docker(['rm', '--force', name]);
}
