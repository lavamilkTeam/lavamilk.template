import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { migrate } from '../server/migrations/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const file = new URL('../.env.postgres.local', import.meta.url);
const password = randomBytes(32).toString('hex');
try {
  await writeFile(file, `POSTGRES_PASSWORD=${password}\nPOSTGRES_PORT=55432\nDATABASE_URL=postgresql://lavamilk_dev:${password}@127.0.0.1:55432/lavamilk_local\nPUBLIC_ORIGIN=http://localhost:5173\nPORT=8091\n`, { flag: 'wx', mode: 0o600 });
} catch (error) { if (error.code !== 'EEXIST') throw error; }
const env = parseEnv(await readFile(file, 'utf8'));
const url = new URL(env.DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || url.pathname !== '/lavamilk_local') throw new Error('Local setup only accepts the loopback lavamilk_local PostgreSQL database');
const child = spawn('docker', ['compose', '-f', 'compose.postgres.yml', '--env-file', '.env.postgres.local', 'up', '-d', '--wait'], { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
if (code !== 0) throw new Error('Local PostgreSQL startup failed');
await migrate(env.DATABASE_URL);
console.log('Local PostgreSQL is ready. Credentials: .env.postgres.local (gitignored). Start API: npm run dev:api:pg');
