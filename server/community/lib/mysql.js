import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { verifySchema } from '../../migrations/index.js';
import { createChatStore, saveProfile } from './chat-store.js';

export async function openStore(url) {
  const pool = mysql.createPool({ uri: url, connectionLimit: 5, timezone: 'Z', supportBigNumbers: true, bigNumberStrings: true });
  pool.on('connection', connection => connection.query("SET time_zone='+00:00'"));
  try { await verifySchema(pool); } catch (error) { await pool.end(); throw error; }
  const decode = x => typeof x === 'string' ? JSON.parse(x) : x;
  async function transaction(fn) {
    const conn = await pool.getConnection();
    try { await conn.beginTransaction(); const result = await fn(conn); await conn.commit(); return result; }
    catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }
  function progress(state) { return {status:'pending',phase:state?.review?.waitUntil>Date.now()?'modelWaiting':state?.phase || 'profile',repositories:state?.repositories?.length || state?.report?.repositories?.length || 0,
    retryAfter:state?.review?.waitUntil ? Math.max(0,Math.ceil((state.review.waitUntil-Date.now())/1000)):0,processed:state?.review?.reviewed || state?.[state?.phase]?.sampled || 0}; }
  return {
    ...createChatStore(pool, transaction),
    async health() { await pool.query('SELECT 1'); },
    close: () => pool.end(),
    async saveOAuth(hash, verifier, expires) {
      await pool.execute('DELETE FROM community_oauth WHERE expires_at < ?', [Date.now()]);
      await pool.execute('DELETE FROM community_sessions WHERE expires_at < ?', [Date.now()]);
      await pool.execute('INSERT INTO community_oauth VALUES (?,?,?)', [hash, verifier, expires]);
    },
    takeOAuth(hash, now) { return transaction(async conn => {
      const [rows] = await conn.execute('SELECT verifier, expires_at FROM community_oauth WHERE state_hash=? FOR UPDATE', [hash]);
      await conn.execute('DELETE FROM community_oauth WHERE state_hash=?', [hash]);
      return rows[0] && Number(rows[0].expires_at) > now ? rows[0].verifier : null;
    }); },
    async signIn(user, tokenHash, expires) {
      return transaction(async conn => {
        // GitHub numeric ID is the identity; usernames can change or be recycled.
        await conn.execute('UPDATE community_users SET login=CONCAT("~retired-",github_id) WHERE login=? AND github_id<>?', [user.login, user.id]);
        await conn.execute(`INSERT INTO community_users (github_id,login,avatar_url) VALUES (?,?,?)
          ON DUPLICATE KEY UPDATE login=VALUES(login),avatar_url=VALUES(avatar_url)`, [user.id, user.login, user.avatar]);
        await saveProfile(conn, user);
        await conn.execute('INSERT INTO community_sessions VALUES (?,?,?)', [tokenHash, user.id, expires]);
      });
    },
    async session(hash, now) {
      const [rows] = await pool.execute(`SELECT u.github_id id,u.login,u.avatar_url avatar FROM community_sessions s
        JOIN community_users u USING(github_id) WHERE s.token_hash=? AND s.expires_at>?`, [hash, now]);
      return rows[0] || null;
    },
    async logout(hash) { await pool.execute('DELETE FROM community_sessions WHERE token_hash=?', [hash]); },
    async leaderboard() {
      const [rows] = await pool.query(`SELECT u.login account,u.avatar_url avatar,r.score,r.eligible,JSON_UNQUOTE(JSON_EXTRACT(r.report,'$.tier')) tier,r.completed_at
        FROM community_reports r JOIN community_users u USING(github_id)
        WHERE r.eligible>=20 AND u.login NOT LIKE '~retired-%' ORDER BY r.score DESC,u.login ASC LIMIT 50`);
      return rows.map(r => ({ account: r.account, avatar: r.avatar, score: r.score, eligible: r.eligible,
        tier: r.tier, scannedAt: new Date(Number(r.completed_at)).toISOString() }));
    },
    async report(login) {
      const [rows] = await pool.execute(`SELECT r.report,u.login FROM community_reports r
        JOIN community_users u USING(github_id) WHERE u.login=?`, [login]);
      return rows[0] ? { ...decode(rows[0].report), account: rows[0].login } : null;
    },
    claim(user, now, begin) { return transaction(async conn => {
      await conn.execute('INSERT IGNORE INTO community_jobs (github_id) VALUES (?)', [user.id]);
      const [[job]] = await conn.execute('SELECT * FROM community_jobs WHERE github_id=? FOR UPDATE', [user.id]);
      const [[saved]] = await conn.execute("SELECT account,completed_at,JSON_EXTRACT(report,'$.version') version,JSON_UNQUOTE(JSON_EXTRACT(report,'$.ai.status')) ai_status FROM community_reports WHERE github_id=?", [user.id]);
      const initial=begin(user.login,now);
      if (saved && saved.ai_status!=='unavailable' && Number(saved.version)===initial.version && Number(saved.completed_at) > now - 6*3600000 && saved.account === user.login)
        {
        const [[cached]]=await conn.execute('SELECT report FROM community_reports WHERE github_id=?',[user.id]);
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
      await conn.execute('UPDATE community_jobs SET state=?,lease=?,locked_until=?,last_request=?,failure=? WHERE github_id=?',
        [JSON.stringify(state), lease, now+120000, now, '', user.id]);
      return { state, lease };
    }); },
    finish(user, lease, state, failure, now, retryAfter) { return transaction(async conn => {
      const [[job]] = await conn.execute('SELECT lease FROM community_jobs WHERE github_id=? FOR UPDATE', [user.id]);
      if (job?.lease !== lease) throw new Error('rateLimit');
      if (state?.phase === 'done') {
        const report = state.report;
        if (report.kind !== 'User') throw new Error('unsupportedAccount');
        const serialized = JSON.stringify(report);
        await conn.execute(`INSERT INTO community_reports VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
          account=VALUES(account),score=VALUES(score),eligible=VALUES(eligible),completed_at=VALUES(completed_at),report=VALUES(report)`,
          [user.id, report.account, report.score, report.ranked ? report.eligible : 0, now, serialized]);
        await conn.execute('INSERT INTO community_report_history VALUES (?,?,?,?)', [randomUUID(), user.id, now, serialized]);
        await conn.execute('UPDATE community_jobs SET state=NULL,lease=NULL,locked_until=0,failure=? WHERE github_id=?', ['',user.id]);
        return { status: 'done', cached: false, report };
      }
      if (state) await conn.execute('UPDATE community_jobs SET state=? WHERE github_id=?', [JSON.stringify(state),user.id]);
      await conn.execute('UPDATE community_jobs SET lease=NULL,locked_until=?,failure=? WHERE github_id=?', [failure ? now+(retryAfter || 60)*1000 : 0, failure || '', user.id]);
      return progress(state);
    }); },
    async importLegacy(reports) {
      for (const report of reports) await pool.execute('INSERT IGNORE INTO community_legacy_reports (account,report) VALUES (?,?)', [report.account, JSON.stringify(report)]);
    },
  };
}
