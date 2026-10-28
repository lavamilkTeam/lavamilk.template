import { connection, transaction, verify, identity, selection, allowed } from './lib/store.js';

// Only verified OAuth identities enter this server-side boundary; no anonymous HTTP writes.
export async function openAccountRegistry(url) {
  const pool=connection(url);
  try { await verify(pool); } catch(error) { await pool.end(); throw error; }
  async function record(id) { return (await pool.query(selection+' WHERE w.github_id=$1',[id])).rows[0]; }
  const text=(v,n)=>typeof v==='string'?v.slice(0,n):null;
  return {
    health:()=>verify(pool),
    close:()=>pool.end(),
    signIn(user) { return transaction(pool,async db=>{
      const now=new Date().toISOString(), p=user.profile || {};
      const uid=await identity(db,user.id,p.name || user.login,now,now);
      const profile={github_id:user.id,github_name:text(p.name,255),github_bio:text(p.bio,512),github_company:text(p.company,255),
        github_location:text(p.location,255),github_blog:typeof p.blog==='string' && /^https?:\/\//i.test(p.blog)?p.blog.slice(0,2048):null,
        github_created_at:p.created_at && Number.isFinite(Date.parse(p.created_at))?new Date(p.created_at).toISOString():null,github_synced_at:now,updated_at:now};
      const initial={...profile,display_name:null,locale:'zh-CN',created_at:now};
      await db.query(`INSERT INTO website_accounts(github_id,user_id,login,avatar_url,created_at,updated_at,profile)
        VALUES($1,$2,$3,$4,$5,$5,$6) ON CONFLICT(github_id) DO UPDATE SET login=EXCLUDED.login,avatar_url=EXCLUDED.avatar_url,
        updated_at=EXCLUDED.updated_at,profile=COALESCE(website_accounts.profile,$6::jsonb) || $7::jsonb`,
      [user.id,uid,user.login,user.avatar,now,JSON.stringify(initial),JSON.stringify(profile)]);
      return uid;
    }); },
    async session(user) {
      const row=await record(user.id);
      return allowed(row)?{id:row.github_id,login:row.login,avatar:row.avatar_url,accountId:row.user_id}:null;
    },
    async profile(user) {
      const row=await record(user.id); if(!allowed(row)) throw new Error('authRequired');
      const p=row.profile || {};
      return {id:row.github_id,accountId:row.user_id,login:row.login,avatar:row.avatar_url,name:p.github_name??null,bio:p.github_bio??null,
        company:p.github_company??null,location:p.github_location??null,website:p.github_blog??null,
        syncedAt:p.github_synced_at?new Date(p.github_synced_at.replace(' ','T')+(p.github_synced_at.endsWith('Z')?'':'Z')).toISOString():null,
        displayName:p.display_name??null,locale:p.locale || 'zh-CN'};
    },
    preferences(user,input) { return transaction(pool,async db=>{
      const row=(await db.query(selection+' WHERE w.github_id=$1 FOR UPDATE OF u',[user.id])).rows[0];
      if(!allowed(row)) throw new Error('authRequired');
      const now=new Date().toISOString();
      await db.query(`UPDATE website_accounts SET profile=COALESCE(profile,$2::jsonb) || $3::jsonb WHERE github_id=$1`,
        [user.id,JSON.stringify({github_id:user.id,created_at:now}),JSON.stringify({display_name:input.displayName,locale:input.locale,updated_at:now})]);
      await db.query('UPDATE account_users SET display_name=$1,updated_at=now() WHERE id=$2',[input.displayName || '',row.user_id]);
    }); },
  };
}
