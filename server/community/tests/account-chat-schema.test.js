// The reviewed DDL is the public interface under test, not private store methods.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { createApplication } from '../index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
test('proposed account/chat schema preserves ownership, idempotency, ordering and deletion', { skip: !databaseUrl }, async t => {
  assert.match(new URL(databaseUrl).pathname, /test/i);
  const app = await createApplication({ databaseUrl, origin: 'https://schema.test' });
  const db = await mysql.createConnection({ uri: databaseUrl, timezone: 'Z' });
  const created = [];
  t.after(async () => {
    try {
      for (const name of created.reverse()) await db.query('DROP TABLE `' + name + '`');
      await db.execute('DELETE FROM community_users WHERE github_id IN (?,?)', ['991001', '991002']);
    } finally { await db.end(); await app.close(); }
  });
  const ddl = await readFile(new URL('../../../docs/database/account-chat.sql', import.meta.url), 'utf8');
  for (const sql of ddl.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) {
    await db.query(sql);
    const table = sql.match(/^CREATE TABLE ([a-z_]+)/)?.[1];
    if (table) created.push(table);
  }
  await db.execute('INSERT INTO community_users (github_id,login,avatar_url) VALUES (?,?,?),(?,?,?)',
    ['991001', 'schema-owner', 'avatar', '991002', 'schema-other', 'avatar']);
  const conversation = randomUUID(), turn = randomUUID(), request = randomUUID();
  await db.execute('INSERT INTO account_profiles (github_id,display_name) VALUES (?,?)', ['991001', '中文🐷']);
  await db.execute('INSERT INTO ai_conversations (id,github_id) VALUES (?,?)', [conversation, '991001']);
  const insert = (id, no, key) => db.execute(`INSERT INTO ai_turns
    (id,conversation_id,turn_no,client_request_id,input_hash,provider,model,prompt_version,generation_options)
    VALUES (?,?,?,?,UNHEX(SHA2('hello',256)),'llamacpp','gemma-4-12b','v1',JSON_OBJECT('max_tokens',700))`, [id, conversation, no, key]);
  await insert(turn, 1, request);
  await t.test('a duplicate request and a concurrent turn cannot be inserted', async () => {
    await assert.rejects(insert(randomUUID(), 2, request), { code: 'ER_DUP_ENTRY' });
    await assert.rejects(insert(randomUUID(), 2, randomUUID()), { code: 'ER_DUP_ENTRY' });
  });
  await t.test('messages use Unicode, reject orphan/duplicate/oversized rows', async () => {
    await db.execute('INSERT INTO ai_messages (id,turn_id,role,content) VALUES (?,?,?,?)', [randomUUID(), turn, 'user', '你好 🐷']);
    await assert.rejects(db.execute('INSERT INTO ai_messages (id,turn_id,role,content) VALUES (?,?,?,?)',
      [randomUUID(), turn, 'user', 'duplicate']), { code: 'ER_DUP_ENTRY' });
    await assert.rejects(db.execute('INSERT INTO ai_messages (id,turn_id,role,content) VALUES (?,?,?,?)',
      [randomUUID(), randomUUID(), 'user', 'orphan']), { code: 'ER_NO_REFERENCED_ROW_2' });
    await assert.rejects(db.execute('INSERT INTO ai_messages (id,turn_id,role,content) VALUES (?,?,?,?)',
      [randomUUID(), turn, 'assistant', 'x'.repeat(65537)]), { code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
    const [[message]] = await db.execute('SELECT content FROM ai_messages WHERE turn_id=?', [turn]);
    assert.equal(message.content, '你好 🐷');
  });
  await t.test('owner-scoped transcript query cannot return another account messages', async () => {
    const sql = `SELECT m.content FROM ai_conversations c JOIN ai_turns t ON t.conversation_id=c.id
      JOIN ai_messages m ON m.turn_id=t.id WHERE c.id=? AND c.github_id=? AND c.deleted_at IS NULL`;
    assert.equal((await db.execute(sql, [conversation, '991002']))[0].length, 0);
    assert.equal((await db.execute(sql, [conversation, '991001']))[0].length, 1);
    await db.execute('UPDATE community_users SET login=? WHERE github_id=?', ['schema-renamed', '991001']);
    assert.equal((await db.execute(sql, [conversation, '991001']))[0].length, 1);
  });
  await t.test('a running turn requires a lease, completion releases its active slot', async () => {
    await assert.rejects(db.execute("UPDATE ai_turns SET status='running' WHERE id=?", [turn]), { code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
    const lease = randomUUID();
    await db.execute("UPDATE ai_turns SET status='running',lease_token=?,lease_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 120 SECOND) WHERE id=?", [lease, turn]);
    const [stale] = await db.execute("UPDATE ai_turns SET status='completed',lease_token=NULL,lease_until=NULL,finished_at=UTC_TIMESTAMP(6) WHERE id=? AND lease_token=?", [turn, randomUUID()]);
    assert.equal(stale.affectedRows, 0);
    await db.beginTransaction();
    await db.execute('INSERT INTO ai_messages (id,turn_id,role,content) VALUES (?,?,?,?)', [randomUUID(), turn, 'assistant', '回答']);
    await db.execute("UPDATE ai_turns SET status='completed',lease_token=NULL,lease_until=NULL,finished_at=UTC_TIMESTAMP(6) WHERE id=? AND lease_token=?", [turn, lease]);
    await db.commit();
    const second = randomUUID();
    await insert(second, 2, randomUUID());
    await db.execute("UPDATE ai_turns SET status='cancelled',finished_at=UTC_TIMESTAMP(6) WHERE id=?", [second]);
    await assert.rejects(insert(randomUUID(), 1, randomUUID()), { code: 'ER_DUP_ENTRY' });
  });
  await t.test('conversation purge cascades to turns/messages, account deletion is explicit', async () => {
    await assert.rejects(db.execute('DELETE FROM community_users WHERE github_id=?', ['991001']), { code: 'ER_ROW_IS_REFERENCED_2' });
    await db.execute('UPDATE ai_conversations SET deleted_at=UTC_TIMESTAMP(6) WHERE id=?', [conversation]);
    assert.equal((await db.execute('SELECT id FROM ai_conversations WHERE id=? AND github_id=? AND deleted_at IS NULL', [conversation, '991001']))[0].length, 0);
    await db.execute('DELETE FROM ai_conversations WHERE id=?', [conversation]);
    assert.equal((await db.execute('SELECT id FROM ai_turns WHERE conversation_id=?', [conversation]))[0].length, 0);
    assert.equal((await db.execute('SELECT id FROM ai_messages WHERE turn_id=?', [turn]))[0].length, 0);
    await db.execute('DELETE FROM community_users WHERE github_id IN (?,?)', ['991001', '991002']);
    assert.equal((await db.execute('SELECT github_id FROM account_profiles WHERE github_id=?', ['991001']))[0].length, 0);
  });
});
