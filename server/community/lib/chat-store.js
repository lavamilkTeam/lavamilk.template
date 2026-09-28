import { createHash, randomUUID } from 'node:crypto';

const selectConversation = `SELECT id,title,state,CAST(revision AS CHAR) revision,
  DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s.%f') updatedAt FROM ai_conversations`;
const safeText = (value, length) => typeof value === 'string' ? value.slice(0, length) : null;
export async function saveProfile(conn, user) {
  const p = user.profile || {};
  await conn.execute(`INSERT INTO account_profiles
    (github_id,github_name,github_bio,github_company,github_location,github_blog,github_created_at,github_synced_at)
    VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE
    github_name=VALUES(github_name),github_bio=VALUES(github_bio),github_company=VALUES(github_company),
    github_location=VALUES(github_location),github_blog=VALUES(github_blog),github_created_at=VALUES(github_created_at),github_synced_at=UTC_TIMESTAMP(6)`,
  [user.id, safeText(p.name,255), safeText(p.bio,512), safeText(p.company,255), safeText(p.location,255),
    typeof p.blog === 'string' && /^https?:\/\//i.test(p.blog) ? p.blog.slice(0,2048) : null,
    p.created_at && Number.isFinite(Date.parse(p.created_at)) ? new Date(p.created_at) : null]);
}

export function createChatStore(pool, transaction) {
  async function owned(db, user, id, lock = false) {
    const [[row]] = await db.execute(`${selectConversation} WHERE id=? AND github_id=? AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [id, user.id]);
    if (!row) throw new Error('notFound');
    return row;
  }
  async function touch(db, id) {
    await db.execute('UPDATE ai_conversations SET revision=revision+1,updated_at=UTC_TIMESTAMP(6) WHERE id=?', [id]);
  }
  async function terminal(db, id, status, error = null) {
    await db.execute('UPDATE ai_turns SET status=?,error_code=?,lease_token=NULL,lease_until=NULL,finished_at=UTC_TIMESTAMP(6) WHERE id=?', [status,error,id]);
  }
  return {
    async profile(user) {
      const [[row]] = await pool.execute(`SELECT u.github_id id,u.login,u.avatar_url avatar,p.github_name name,p.github_bio bio,
        p.github_company company,p.github_location location,p.github_blog website,p.github_synced_at syncedAt,p.display_name displayName,
        COALESCE(p.locale,'zh-CN') locale FROM community_users u LEFT JOIN account_profiles p USING(github_id) WHERE github_id=?`, [user.id]);
      return row;
    },
    async preferences(user, input) {
      await pool.execute(`INSERT INTO account_profiles (github_id,display_name,locale) VALUES (?,?,?)
        ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),locale=VALUES(locale)`, [user.id,input.displayName,input.locale]);
    },
    async conversations(user, state, cursor) {
      const [rows] = await pool.execute(`${selectConversation} WHERE github_id=? AND deleted_at IS NULL AND state=?
        ${cursor ? 'AND (updated_at < ? OR (updated_at = ? AND id < ?))' : ''}
        ORDER BY updated_at DESC,id DESC LIMIT 31`, [user.id,state,...(cursor ? [cursor[0],cursor[0],cursor[1]] : [])]);
      const items = rows.slice(0,30), last = items.at(-1);
      return { items, cursor: rows.length > 30 ? Buffer.from(JSON.stringify([last.updatedAt,last.id])).toString('base64url') : null };
    },
    createConversation(user, id) { return transaction(async db => {
      try { await db.execute('INSERT INTO ai_conversations (id,github_id) VALUES (?,?)', [id,user.id]); }
      catch (error) { if (error.code !== 'ER_DUP_ENTRY') throw error; }
      return owned(db,user,id);
    }); },
    editConversation(user,id,input) { return transaction(async db => {
      const row = await owned(db,user,id,true);
      if (row.revision !== String(input.expectedRevision)) throw new Error('conflict');
      const [[active]] = await db.execute('SELECT id FROM ai_turns WHERE conversation_id=? AND active_slot=1', [id]);
      if (active && input.state === 'archived') throw new Error('conversationBusy');
      await db.execute('UPDATE ai_conversations SET title=?,state=? WHERE id=?', [input.title ?? row.title,input.state ?? row.state,id]);
      await touch(db,id); return owned(db,user,id);
    }); },
    deleteConversation(user,id) { return transaction(async db => {
      await owned(db,user,id,true);
      await db.execute("UPDATE ai_turns SET status='cancelled',lease_token=NULL,lease_until=NULL,finished_at=UTC_TIMESTAMP(6) WHERE conversation_id=? AND active_slot=1", [id]);
      await db.execute('UPDATE ai_conversations SET deleted_at=UTC_TIMESTAMP(6),revision=revision+1 WHERE id=?', [id]);
    }); },
    async turns(user,id,before) {
      const conversation = await owned(pool,user,id);
      const [rows] = await pool.execute(`SELECT id,CAST(turn_no AS CHAR) turnNo,status,attempt_no attempt,error_code error,
        finish_reason finishReason FROM ai_turns WHERE conversation_id=? ${before ? 'AND turn_no<?' : ''} ORDER BY turn_no DESC LIMIT 21`, [id,...(before ? [before] : [])]);
      const items = rows.slice(0,20).reverse();
      if (items.length) {
        const [messages] = await pool.execute(`SELECT id,turn_id turnId,role,content FROM ai_messages WHERE turn_id IN (${items.map(()=>'?').join(',')}) ORDER BY FIELD(role,'user','assistant')`, items.map(t=>t.id));
        for (const turn of items) turn.messages = messages.filter(m=>m.turnId === turn.id);
      }
      return { conversation, items, before: rows.length > 20 ? items[0].turnNo : null };
    },
    enqueue(user,id,input,model) { return transaction(async db => {
      await db.execute('SELECT github_id FROM community_users WHERE github_id=? FOR UPDATE', [user.id]);
      const conversation = await owned(db,user,id,true);
      const digest = createHash('sha256').update(input.content).digest();
      const [[existing]] = await db.execute('SELECT id,input_hash FROM ai_turns WHERE conversation_id=? AND client_request_id=?', [id,input.clientRequestId]);
      if (existing) {
        if (!existing.input_hash.equals(digest)) throw new Error('conflict');
        return { id: existing.id };
      }
      if (conversation.state !== 'active') throw new Error('conflict');
      const [[active]] = await db.execute('SELECT t.id FROM ai_turns t JOIN ai_conversations c ON c.id=t.conversation_id WHERE c.github_id=? AND t.active_slot=1 LIMIT 1', [user.id]);
      if (active) throw new Error('conversationBusy');
      const [[recent]] = await db.execute('SELECT t.id FROM ai_turns t JOIN ai_conversations c ON c.id=t.conversation_id WHERE c.github_id=? AND t.created_at>DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 3 SECOND) LIMIT 1', [user.id]);
      if (recent) throw new Error('rateLimit');
      const [[counter]] = await db.execute('SELECT next_turn_no FROM ai_conversations WHERE id=?', [id]);
      const turnId = randomUUID();
      await db.execute(`INSERT INTO ai_turns (id,conversation_id,turn_no,client_request_id,input_hash,provider,model,prompt_version,context_through_turn_no,generation_options)
        VALUES (?,?,?,?,?,?,?,'v1',?,JSON_OBJECT('max_tokens',700))`, [turnId,id,counter.next_turn_no,input.clientRequestId,digest,model.provider || 'openai-compatible',model.model,BigInt(counter.next_turn_no)-1n]);
      await db.execute("INSERT INTO ai_messages (id,turn_id,role,content) VALUES (?,?,'user',?)", [randomUUID(),turnId,input.content]);
      await db.execute('UPDATE ai_conversations SET next_turn_no=next_turn_no+1 WHERE id=?', [id]);
      if (String(counter.next_turn_no) === '1') await db.execute('UPDATE ai_conversations SET title=? WHERE id=?', [input.content.slice(0,80),id]);
      await touch(db,id); return { id: turnId };
    }); },
    changeTurn(user,conversationId,turnId,action,expectedAttempt) { return transaction(async db => {
      await db.execute('SELECT github_id FROM community_users WHERE github_id=? FOR UPDATE', [user.id]);
      const conversation = await owned(db,user,conversationId,true);
      const [[turn]] = await db.execute('SELECT * FROM ai_turns WHERE id=? AND conversation_id=? FOR UPDATE', [turnId,conversationId]);
      if (!turn) throw new Error('notFound');
      if (action === 'cancel') {
        if (['pending','running'].includes(turn.status)) { await terminal(db,turnId,'cancelled'); await touch(db,conversationId); }
        return;
      }
      if (Number(turn.attempt_no) > expectedAttempt) return;
      if (Number(turn.attempt_no) !== expectedAttempt || !['failed','cancelled'].includes(turn.status) || conversation.state !== 'active') throw new Error('conflict');
      const [[counter]] = await db.execute('SELECT next_turn_no FROM ai_conversations WHERE id=?', [conversationId]);
      if (BigInt(counter.next_turn_no) !== BigInt(turn.turn_no)+1n) throw new Error('conflict');
      const [[active]] = await db.execute('SELECT t.id FROM ai_turns t JOIN ai_conversations c ON c.id=t.conversation_id WHERE c.github_id=? AND t.active_slot=1 LIMIT 1', [user.id]);
      if (active) throw new Error('conversationBusy');
      if (turn.finished_at && Date.now()-new Date(turn.finished_at).getTime() < 3000) throw new Error('rateLimit');
      await db.execute(`UPDATE ai_turns SET status='pending',attempt_no=attempt_no+1,started_at=NULL,finished_at=NULL,
        error_code=NULL,finish_reason=NULL,input_tokens=NULL,output_tokens=NULL,latency_ms=NULL,created_at=UTC_TIMESTAMP(6) WHERE id=?`, [turnId]);
      await touch(db,conversationId);
    }); },
    async claimTurn() {
      // Candidate read takes no row lock; every mutation locks conversation before turn.
      const [[candidate]] = await pool.query("SELECT conversation_id,id FROM ai_turns WHERE status='pending' ORDER BY created_at,id LIMIT 1");
      if (!candidate) return null;
      return transaction(async db => {
        const [[conversation]] = await db.execute('SELECT github_id,deleted_at,state FROM ai_conversations WHERE id=? FOR UPDATE', [candidate.conversation_id]);
        const [[turn]] = await db.execute("SELECT * FROM ai_turns WHERE id=? AND status='pending' FOR UPDATE", [candidate.id]);
        if (!turn) return null;
        if (!conversation || conversation.deleted_at || conversation.state !== 'active') { await terminal(db,turn.id,'cancelled'); return null; }
        const lease = randomUUID();
        await db.execute("UPDATE ai_turns SET status='running',lease_token=?,lease_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 120 SECOND),started_at=UTC_TIMESTAMP(6) WHERE id=?", [lease,turn.id]);
        return { ...turn, lease, user: { id: conversation.github_id } };
      });
    },
    async context(turn) {
      const [rows] = await pool.execute(`SELECT t.turn_no,m.role,m.content FROM ai_turns t JOIN ai_messages m ON m.turn_id=t.id
        WHERE t.conversation_id=? AND ((t.status='completed' AND t.turn_no<=?) OR t.id=?)
        ORDER BY t.turn_no DESC,FIELD(m.role,'assistant','user') LIMIT 21`, [turn.conversation_id,turn.context_through_turn_no,turn.id]);
      const current = rows.find(m=>String(m.turn_no)===String(turn.turn_no) && m.role==='user');
      if (!current) throw new Error('invalidMessage');
      const messages = [{ role: 'user', content: current.content }];
      let size = current.content.length;
      const prior = rows.filter(m=>String(m.turn_no)!==String(turn.turn_no));
      for (let i=0; i+1<prior.length; i+=2) {
        const assistant=prior[i], user=prior[i+1];
        if (assistant.role!=='assistant' || user.role!=='user' || String(assistant.turn_no)!==String(user.turn_no) ||
          assistant.content.length>6000 || size+user.content.length+assistant.content.length>12000) break;
        messages.unshift({role:'user',content:user.content},{role:'assistant',content:assistant.content});
        size+=user.content.length+assistant.content.length;
      }
      return messages;
    },
    completeTurn(turn,result,error) { return transaction(async db => {
      const [[conversation]] = await db.execute('SELECT deleted_at FROM ai_conversations WHERE id=? FOR UPDATE', [turn.conversation_id]);
      const [[current]] = await db.execute('SELECT status,lease_token FROM ai_turns WHERE id=? AND lease_until>UTC_TIMESTAMP(6) FOR UPDATE', [turn.id]);
      if (!conversation || conversation.deleted_at || current?.status !== 'running' || current.lease_token !== turn.lease) return;
      if (error) await terminal(db,turn.id,'failed',error);
      else {
        await db.execute("INSERT INTO ai_messages (id,turn_id,role,content) VALUES (?,?,'assistant',?)", [randomUUID(),turn.id,result.message]);
        await terminal(db,turn.id,'completed');
        await db.execute('UPDATE ai_turns SET finish_reason=?,input_tokens=?,output_tokens=?,latency_ms=? WHERE id=?', [result.truncated?'length':'stop',result.inputTokens ?? null,result.outputTokens ?? null,result.latencyMs ?? null,turn.id]);
      }
      await touch(db,turn.conversation_id);
    }); },
    async leaseActive(turn) {
      const [[row]] = await pool.execute("SELECT id FROM ai_turns WHERE id=? AND lease_token=? AND status='running'", [turn.id,turn.lease]);
      return !!row;
    },
    async recoverTurns() {
      const [rows] = await pool.query("SELECT id,conversation_id FROM ai_turns WHERE (status='running' AND lease_until<UTC_TIMESTAMP(6)) OR (status='pending' AND created_at<DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 120 SECOND)) LIMIT 100");
      for (const row of rows) await transaction(async db => {
        await db.execute('SELECT id FROM ai_conversations WHERE id=? FOR UPDATE', [row.conversation_id]);
        const [[expired]] = await db.execute("SELECT id FROM ai_turns WHERE id=? AND ((status='running' AND lease_until<UTC_TIMESTAMP(6)) OR (status='pending' AND created_at<DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 120 SECOND))) FOR UPDATE", [row.id]);
        if (expired) { await terminal(db,row.id,'failed','interrupted'); await touch(db,row.conversation_id); }
      });
      await pool.query('DELETE FROM ai_conversations WHERE deleted_at<DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 7 DAY) LIMIT 20');
    },
  };
}
