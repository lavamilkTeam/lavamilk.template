// Run integration tests against a disposable real MySQL, never the app database.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
const require = createRequire(new URL('../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');
const name = 'lavamilk-test-' + randomUUID();
let created = false;
let databaseUrl = process.env.TEST_DATABASE_URL;
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr.trim());
  return result.stdout.trim();
}
try {
  if (!databaseUrl) {
    const password = randomUUID();
    docker(['run', '--detach', '--rm', '--name', name, '-p', '127.0.0.1::3306',
      '-e', 'MYSQL_ROOT_PASSWORD=' + password, '-e', 'MYSQL_DATABASE=lavamilk_test',
      '-e', 'MYSQL_USER=tester', '-e', 'MYSQL_PASSWORD=' + password, 'mysql:8.4']);
    created = true;
    const port = docker(['port', name, '3306/tcp']).split(':').at(-1);
    databaseUrl = `mysql://tester:${password}@127.0.0.1:${port}/lavamilk_test`;
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { const connection = await mysql.createConnection(databaseUrl); await connection.end(); ready = true; break; }
      catch { await delay(1000); }
    }
    if (!ready) throw new Error('Isolated MySQL did not become ready within 60 seconds');
  }
  // An explicitly supplied database must also be a dedicated test database.
  if (!/test/i.test(new URL(databaseUrl).pathname)) throw new Error('TEST_DATABASE_URL must name a dedicated test database');
  const child = spawn('npm', ['test', '--prefix', 'server'], {
    stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: databaseUrl },
  });
  process.exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => resolve(code ?? 1)); });
} catch (error) {
  console.error('Integration tests failed:', error.message);
  process.exitCode = 1;
} finally {
  if (created) docker(['rm', '--force', name]);
}
