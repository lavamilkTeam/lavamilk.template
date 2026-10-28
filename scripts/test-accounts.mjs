import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
const require=createRequire(new URL('../server/package.json',import.meta.url));
const mysql=require('mysql2/promise'), {Client}=require('pg'), owned=[];
let source=process.env.TEST_DATABASE_URL,target=process.env.TEST_POSTGRES_URL;
function docker(args) { const r=spawnSync('docker',args,{encoding:'utf8'}); if(r.status!==0) throw new Error(r.stderr); return r.stdout.trim(); }
try {
  for(const kind of ['mysql','postgres']) {
    if(kind==='mysql'?source:target) continue;
    const name='lavamilk-account-test-'+randomUUID(),password=randomUUID(),mysqlMode=kind==='mysql',port=mysqlMode?'3306':'5432';
    docker(['run','-d','--rm','--name',name,'-p','127.0.0.1::'+port,...(mysqlMode?['-e','MYSQL_ROOT_PASSWORD='+password,'-e','MYSQL_DATABASE=lavamilk_test']:['-e','POSTGRES_PASSWORD='+password,'-e','POSTGRES_DB=lavamilk_test']),mysqlMode?'mysql:8.4':'postgres:18-alpine']);
    owned.push(name);
    const url=(mysqlMode?'mysql://root:':'postgresql://postgres:')+password+'@127.0.0.1:'+docker(['port',name,port+'/tcp']).split(':').at(-1)+'/lavamilk_test';
    let ready=false;
    for(let i=0;i<60;i++) {
      let db;
      try { db=mysqlMode?await mysql.createConnection(url):new Client({connectionString:url,connectionTimeoutMillis:1000}); if(!mysqlMode) await db.connect(); ready=true; }
      catch { await delay(1000); }
      finally { if(db) await db.end(); }
      if(ready) break;
    }
    if(!ready) throw new Error('Account test database unavailable');
    if(mysqlMode) source=url; else target=url;
  }
  if(![source,target].every(url=>new URL(url).pathname.includes('test'))) throw new Error('Dedicated test databases required');
  const env={...process.env,TEST_DATABASE_URL:source,TEST_POSTGRES_URL:target,MIGRATION_DATABASE_URL:source};
  if(spawnSync(process.execPath,['server/migrate.js'],{stdio:'inherit',env}).status!==0) throw new Error('MySQL test migration failed');
  process.exitCode=spawnSync(process.execPath,['--test','--test-concurrency=1','server/accounts/tests/migration.test.js'],{stdio:'inherit',env}).status ?? 1;
} finally { for(const name of owned) docker(['rm','-f',name]); }
