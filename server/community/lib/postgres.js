import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { verifySchema } from '../../migrations/index.js';
import { createChatStore, saveProfile } from './postgres-chat-store.js';

export async function openStore(url) {
  const pool = new pg.Pool({ connectionString: url, max: 5, options: '-c timezone=UTC', connectionTimeoutMillis: 10000 });
  // Idle pool errors must not terminate the HTTP process; requests still fail closed.
  pool.on('error', () => {});
  try { await verifySchema(pool, 'postgresql'); } catch (error) { await pool.end(); throw error; }
  const decode = x => typeof x === 'string' ? JSON.parse(x) : x;
  async function transaction(fn) {
    const conn = await pool.connect();
    try { await conn.query('BEGIN'); const result = await fn(conn); await conn.query('COMMIT'); return result; }
    catch (e) { await conn.query('ROLLBACK'); throw e; } finally { conn.release(); }
  }
  function progress(state) { return {status:'pending',phase:state?.review?.waitUntil>Date.now()?'modelWaiting':state?.phase || 'profile',repositories:state?.repositories?.length || state?.report?.repositories?.length || 0,
    retryAfter:state?.review?.waitUntil ? Math.max(0,Math.ceil((state.review.waitUntil-Date.now())/1000)):0,processed:state?.review?.reviewed || state?.[state?.phase]?.sampled || 0}; }
  return {
    ...createChatStore(pool, transaction),
    dialect: 'postgresql',
    async health() { await pool.query('SELECT 1'); },
    close: () => pool.end(),
    async saveOAuth(hash, verifier, expires) {
      await pool.query('DELETE FROM community_oauth WHERE expires_at < $1', [Date.now()]);
      await pool.query('DELETE FROM community_sessions WHERE expires_at < $1', [Date.now()]);
      await pool.query('INSERT INTO community_oauth VALUES ($1,$2,$3)', [hash, verifier, expires]);
    },
    takeOAuth(hash, now) { return transaction(async conn => {
      const { rows } = await conn.query('SELECT verifier, expires_at FROM community_oauth WHERE state_hash=$1 FOR UPDATE', [hash]);
      await conn.query('DELETE FROM community_oauth WHERE state_hash=$1', [hash]);
      return rows[0] && Number(rows[0].expires_at) > now ? rows[0].verifier : null;
    }); },
    async signIn(user, tokenHash, expires) {
      return transaction(async conn => {
        // GitHub numeric ID is the identity; usernames can change or be recycled.
        await conn.query("UPDATE community_users SET login=CONCAT('~retired-',github_id) WHERE login=$1 AND github_id<>$2", [user.login, user.id]);
        await conn.query(`INSERT INTO community_users (github_id,login,avatar_url) VALUES ($1,$2,$3)
          ON CONFLICT (github_id) DO UPDATE SET login=EXCLUDED.login,avatar_url=EXCLUDED.avatar_url,updated_at=clock_timestamp()`, [user.id, user.login, user.avatar]);
        await saveProfile(conn, user);
        await conn.query('INSERT INTO community_sessions VALUES ($1,$2,$3)', [tokenHash, user.id, expires]);
      });
    },
    async session(hash, now) {
      const { rows } = await pool.query(`SELECT u.github_id id,u.login,u.avatar_url avatar FROM community_sessions s
        JOIN community_users u USING(github_id) WHERE s.token_hash=$1 AND s.expires_at>$2`, [hash, now]);
      return rows[0] || null;
    },
    async logout(hash) { await pool.query('DELETE FROM community_sessions WHERE token_hash=$1', [hash]); },
    async leaderboard() {
      const { rows } = await pool.query(`SELECT u.login account,u.avatar_url avatar,r.score,r.eligible,(r.report->>'tier') tier,r.completed_at
        FROM community_reports r JOIN community_users u USING(github_id)
        WHERE r.eligible>=20 AND u.login NOT LIKE '~retired-%' ORDER BY r.score DESC,u.login ASC LIMIT 50`);
      return rows.map(r => ({ account: r.account, avatar: r.avatar, score: r.score, eligible: r.eligible,
        tier: r.tier, scannedAt: new Date(Number(r.completed_at)).toISOString() }));
    },
    async report(login) {
      const { rows } = await pool.query(`SELECT r.report,u.login FROM community_reports r
        JOIN community_users u USING(github_id) WHERE u.login=$1`, [login]);
      return rows[0] ? { ...decode(rows[0].report), account: rows[0].login } : null;
    },
    claim(user, now, begin) { return transaction(async conn => {
      await conn.query('INSERT INTO community_jobs (github_id) VALUES ($1) ON CONFLICT (github_id) DO NOTHING', [user.id]);
      const { rows: [job] } = await conn.query('SELECT * FROM community_jobs WHERE github_id=$1 FOR UPDATE', [user.id]);
      const { rows: [saved] } = await conn.query("SELECT account,completed_at,(report->>'version') version,(report->'ai'->>'status') ai_status FROM community_reports WHERE github_id=$1", [user.id]);
      const initial=begin(user.login,now);
      if (saved && saved.ai_status!=='unavailable' && Number(saved.version)===initial.version && Number(saved.completed_at) > now - 6*3600000 && saved.account === user.login)
        {
        const { rows: [cached] }=await conn.query('SELECT report FROM community_reports WHERE github_id=$1',[user.id]);
        return {response:{status:'done',cached:true,report:decode(cached.report)}};
      }
      let state = decode(job.state);
      if (Number(job.locked_until) > now) {
        if (job.failure) throw Object.assign(new Error(job.failure),{retryAfter:Math.ceil((Number(job.locked_until)-now)/1000)});
        return { response: progress(state) };
      }
      if (now - Number(job.last_request) < 2000) throw new Error('rateLimit');
      if (!state || state.version!==initial.version || state.account!==user.login || Date.parse(state.startedAt)<now-7*86400000) state=initial;
      const lease = randomUUID();
      await conn.query('UPDATE community_jobs SET state=$1,lease=$2,locked_until=$3,last_request=$4,failure=$5 WHERE github_id=$6',
        [JSON.stringify(state), lease, now+120000, now, '', user.id]);
      return { state, lease };
    }); },
    finish(user, lease, state, failure, now, retryAfter) { return transaction(async conn => {
      const { rows: [job] } = await conn.query('SELECT lease FROM community_jobs WHERE github_id=$1 FOR UPDATE', [user.id]);
      if (job?.lease !== lease) throw new Error('rateLimit');
      if (state?.phase === 'done') {
        const report = state.report;
        if (report.kind !== 'User') throw new Error('unsupportedAccount');
        const serialized = JSON.stringify(report);
        await conn.query(`INSERT INTO community_reports VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (github_id) DO UPDATE SET
          account=EXCLUDED.account,score=EXCLUDED.score,eligible=EXCLUDED.eligible,completed_at=EXCLUDED.completed_at,report=EXCLUDED.report`,
          [user.id, report.account, report.score, report.ranked ? report.eligible : 0, now, serialized]);
        await conn.query('INSERT INTO community_report_history VALUES ($1,$2,$3,$4)', [randomUUID(), user.id, now, serialized]);
        await conn.query('UPDATE community_jobs SET state=NULL,lease=NULL,locked_until=0,failure=$1 WHERE github_id=$2', ['',user.id]);
        return { status: 'done', cached: false, report };
      }
      if (state) await conn.query('UPDATE community_jobs SET state=$1 WHERE github_id=$2', [JSON.stringify(state),user.id]);
      await conn.query('UPDATE community_jobs SET lease=NULL,locked_until=$1,failure=$2 WHERE github_id=$3', [failure ? now+(retryAfter || 60)*1000 : 0, failure || '', user.id]);
      return progress(state);
    }); },
    async importLegacy(reports) {
      for (const report of reports) await pool.query('INSERT INTO community_legacy_reports (account,report) VALUES ($1,$2) ON CONFLICT (account) DO NOTHING', [report.account, JSON.stringify(report)]);
    },
  };
}
