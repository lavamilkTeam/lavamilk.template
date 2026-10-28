import mysql from 'mysql2/promise';
import { createHash } from 'node:crypto';
import { connection, identity, verify, selection, allowed } from './lib/store.js';

const stable=v=>Array.isArray(v)?v.map(stable):v && typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const digest=rows=>createHash('sha256').update(JSON.stringify(stable(rows))).digest('hex');
const time=value=>String(value).replace(' ','T')+'Z';

export async function importWebsiteAccounts({sourceUrl,targetUrl,mode='preview'}) {
  if(!['preview','apply','verify'].includes(mode) || new URL(sourceUrl).protocol!=='mysql:' || !['postgres:','postgresql:'].includes(new URL(targetUrl).protocol)) throw new Error('Invalid account transfer configuration');
  const source=await mysql.createConnection({uri:sourceUrl,timezone:'Z',dateStrings:true,supportBigNumbers:true,bigNumberStrings:true});
  const pool=connection(targetUrl), db=await pool.connect();
  try {
    await source.query("SET time_zone='+00:00'");
    await source.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await source.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    await db.query('BEGIN');
    await db.query("SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s'");
    await verify(db);
    await db.query('LOCK TABLE website_accounts IN SHARE ROW EXCLUSIVE MODE');
    const [[count]]=await source.query('SELECT count(*) n FROM community_users');
    if(Number(count.n)>100000) throw new Error('Account transfer limit exceeded');
    const [users]=await source.query('SELECT github_id,login,avatar_url,created_at,updated_at FROM community_users ORDER BY github_id');
    const [profiles]=await source.query('SELECT * FROM account_profiles ORDER BY github_id');
    if(profiles.some(p=>!users.some(u=>u.github_id===p.github_id))) throw new Error('Orphan source profile');
    const expected=users.map(u=>({...u,profile:profiles.find(p=>p.github_id===u.github_id)||null}));
    if(mode!=='verify') for(const row of expected) {
      const uid=await identity(db,row.github_id,row.profile?.display_name || row.profile?.github_name || row.login,time(row.created_at),time(row.updated_at));
      await db.query(`INSERT INTO website_accounts(github_id,user_id,login,avatar_url,created_at,updated_at,profile)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(github_id) DO NOTHING`,
      [row.github_id,uid,row.login,row.avatar_url,time(row.created_at),time(row.updated_at),row.profile?JSON.stringify(row.profile):null]);
    }
    const {rows}=await db.query(`SELECT github_id,login,avatar_url,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') created_at,
      to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') updated_at,profile FROM website_accounts ORDER BY github_id`);
    const normalize=rows=>rows.map(r=>({...r,created_at:r.created_at.includes('.')?r.created_at:r.created_at+'.000000',updated_at:r.updated_at.includes('.')?r.updated_at:r.updated_at+'.000000'}));
    const sourceHash=digest(normalize(expected)),targetHash=digest(normalize(rows));
    if(sourceHash!==targetHash) throw new Error('Account copy differs from source; transaction rolled back');
    const bound=await db.query(selection);
    if(bound.rowCount!==users.length || bound.rows.some(r=>!allowed(r))) throw new Error('Identity or platform mapping mismatch');
    await db.query(mode==='apply'?'COMMIT':'ROLLBACK');
    return {mode,accounts:users.length,profiles:profiles.length,sourceHash,targetHash,identities:bound.rowCount};
  } finally {
    await db.query('ROLLBACK').catch(()=>{}); db.release(); await pool.end();
    await source.query('ROLLBACK').catch(()=>{}); await source.end();
  }
}
