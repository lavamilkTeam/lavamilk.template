import pg from 'pg';

export const platform = 'lavamilk-web';
export function connection(url) {
  const pool = new pg.Pool({connectionString:url,max:4,connectionTimeoutMillis:5000,query_timeout:10000});
  pool.on('error',()=>{});
  return pool;
}
export async function transaction(pool, fn) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='5s'; SET LOCAL TIME ZONE 'UTC'");
    const value=await fn(db); await db.query('COMMIT'); return value;
  } catch(error) { await db.query('ROLLBACK').catch(()=>{}); throw error; }
  finally { db.release(); }
}
export async function verify(db) {
  const result=await db.query('SELECT version FROM website_account_schema');
  if(result.rowCount!==1 || result.rows[0].version!==1) throw new Error('Invalid website account schema');
  const shared=await db.query('SELECT version FROM account_schema');
  if(shared.rowCount!==1 || shared.rows[0].version!==1) throw new Error('Invalid shared account schema');
  const found=await db.query('SELECT id,status FROM account_platforms WHERE code=$1',[platform]);
  if(found.rowCount!==1 || found.rows[0].status!=='active') throw new Error('Account platform unavailable');
  await db.query('SELECT github_id,user_id,login,avatar_url,created_at,updated_at,profile FROM website_accounts LIMIT 0');
}
export async function identity(db, id, displayName, created, updated) {
  if(!/^[0-9]{1,24}$/.test(id)) throw new Error('Invalid GitHub identity');
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('github:' || $1,0))",[id]);
  let user=(await db.query(`SELECT u.id,u.status FROM account_identities i JOIN account_users u ON u.id=i.user_id
    WHERE i.provider='github' AND i.subject=$1 FOR UPDATE OF u`,[id])).rows[0];
  if(!user) {
    user=(await db.query(`INSERT INTO account_users(display_name,created_at,updated_at) VALUES($1,$2,$3) RETURNING id,status`,
      [(displayName || '').slice(0,80),created,updated])).rows[0];
    await db.query("INSERT INTO account_identities(user_id,provider,subject,created_at) VALUES($1,'github',$2,$3)",[user.id,id,created]);
  }
  if(user.status!=='active') throw new Error('authRequired');
  const p=(await db.query('SELECT id,status FROM account_platforms WHERE code=$1',[platform])).rows[0];
  if(!p || p.status!=='active') throw new Error('authRequired');
  await db.query('INSERT INTO account_memberships(user_id,platform_id,joined_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[user.id,p.id,created]);
  const member=(await db.query('SELECT status FROM account_memberships WHERE user_id=$1 AND platform_id=$2',[user.id,p.id])).rows[0];
  if(member.status!=='active') throw new Error('authRequired');
  return user.id;
}
export const selection = `SELECT w.*,u.status user_status,m.status membership_status,p.status platform_status
  FROM website_accounts w JOIN account_users u ON u.id=w.user_id
  JOIN account_identities i ON i.user_id=u.id AND i.provider='github' AND i.subject=w.github_id
  JOIN account_platforms p ON p.code='lavamilk-web'
  JOIN account_memberships m ON m.user_id=u.id AND m.platform_id=p.id`;
export const allowed = row => row && [row.user_status,row.membership_status,row.platform_status].every(v=>v==='active');
