import { importWebsiteAccounts } from './accounts/import.js';
const flag=process.argv[2];
if(process.argv.length>3 || (flag && !['--apply','--verify'].includes(flag))) throw new Error('Use --apply, --verify, or no flag for transactional preview');
try {
  console.log(JSON.stringify(await importWebsiteAccounts({sourceUrl:process.env.SOURCE_MYSQL_URL,targetUrl:process.env.ACCOUNT_DATABASE_URL,
    mode:flag==='--apply'?'apply':flag==='--verify'?'verify':'preview'}),null,2));
} catch { console.error('Account migration failed; no account records or credentials are logged. Check schema, grants and data conflicts.'); process.exitCode=1; }
