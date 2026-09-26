import { readFile } from 'node:fs/promises';
import { syncContent } from './cms-sync/index.mjs';

try {
  const content = JSON.parse(await readFile(new URL('../src/locales/en.json', import.meta.url), 'utf8')).content;
  const results = await syncContent({ content, base: 'http://127.0.0.1:8090/api',
    email: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD });
  for (const r of results) console.log(`✔ ${r.name}: 更新 ${r.updated} / 新增 ${r.created} / 删除 ${r.removed}`);
  console.log('\n✅ 同步完成（集合结构未动）');
} catch (error) {
  console.error('❌', error.message);
  process.exitCode = 1;
}
