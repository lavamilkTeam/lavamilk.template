import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import pg from 'pg';
import { createApplication } from '../index.js';
import { migrate, checkSchema } from '../../migrations/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('PostgreSQL constraints, UTC cursors, bigint contracts and migration checks', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl);
  assert(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.match(url.pathname, /test/i);
  await Promise.all([migrate(databaseUrl), migrate(databaseUrl)]);
  const db = new pg.Client({ connectionString: databaseUrl, options: '-c timezone=UTC' });
  await db.connect();
  const origin = 'https://postgres.test';
  const config = { databaseUrl, origin, clientId: 'test', clientSecret: 'test', startChatWorker: false };
  const app = await createApplication(config, { fetch: async url => new Response(JSON.stringify(
    url.includes('/access_token') ? { access_token: 'temporary' } : { id: 991001, login: 'postgres-owner', type: 'User' })) });
  const server = createServer(app.handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await app.close();
    try {
      await db.query("DELETE FROM ai_conversations WHERE github_id IN ('991001','991002')");
      await db.query("DELETE FROM community_sessions WHERE github_id IN ('991001','991002')");
      await db.query("DELETE FROM community_users WHERE github_id IN ('991001','991002')");
    } finally { await db.end(); }
  });
  const base = `http://127.0.0.1:${server.address().port}/api/pig-king/`;
  const req = (path, cookie = '', method = 'GET', body) => fetch(base + path, {
    redirect: 'manual', method, headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const start = await req('auth/login');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const callback = await req('auth/callback?code=ok&state=' + state, start.headers.getSetCookie()[0].split(';')[0]);
  const cookie = callback.headers.getSetCookie().find(x => x.startsWith('pig_session=')).split(';')[0];
  assert.deepEqual(await (await req('health')).json(), { status: 'ok', database: 'postgresql', oauthConfigured: true });
  await db.query("INSERT INTO community_users (github_id,login,avatar_url) VALUES ('991002','postgres-other','avatar')");
  const conversation = randomUUID(), turn = randomUUID(), request = randomUUID();
  await db.query("INSERT INTO ai_conversations (id,github_id) VALUES ($1,'991001')", [conversation]);
  const insert = (id, no, key) => db.query(`INSERT INTO ai_turns
    (id,conversation_id,turn_no,client_request_id,input_hash,provider,model,prompt_version,generation_options)
    VALUES ($1,$2,$3,$4,$5,'test','test','v1','{}')`, [id,conversation,no,key,Buffer.alloc(32)]);
  await insert(turn, 1, request);

  await t.test('unique requests, active slots, FK, Unicode and message byte limits', async () => {
    await assert.rejects(insert(randomUUID(), 2, request), { code: '23505' });
    await assert.rejects(insert(randomUUID(), 2, randomUUID()), { code: '23505' });
    await db.query("INSERT INTO ai_messages (id,turn_id,role,content) VALUES ($1,$2,'user','你好 🐷')", [randomUUID(),turn]);
    await assert.rejects(db.query("INSERT INTO ai_messages (id,turn_id,role,content) VALUES ($1,$2,'user','duplicate')", [randomUUID(),turn]), { code: '23505' });
    await assert.rejects(db.query("INSERT INTO ai_messages (id,turn_id,role,content) VALUES ($1,$2,'user','orphan')", [randomUUID(),randomUUID()]), { code: '23503' });
    await assert.rejects(db.query("INSERT INTO ai_messages (id,turn_id,role,content) VALUES ($1,$2,'assistant',$3)", [randomUUID(),turn,'猪'.repeat(21846)]), { code: '23514' });
    const history = await (await req('chat/conversations/' + conversation + '/turns', cookie)).json();
    assert.equal(history.items[0].messages[0].content, '你好 🐷');
    assert.equal(history.items[0].turnNo, '1');
    await assert.rejects(db.query("UPDATE ai_turns SET generation_options='[]' WHERE id=$1", [turn]), { code: '23514' });
  });
  await t.test('leases reject invalid state; completion frees active slot and purge cascades', async () => {
    await assert.rejects(db.query("UPDATE ai_turns SET status='running' WHERE id=$1", [turn]), { code: '23514' });
    const lease = randomUUID();
    await db.query("UPDATE ai_turns SET status='running',lease_token=$1,lease_until=clock_timestamp()+interval '120 seconds' WHERE id=$2", [lease,turn]);
    const stale = await db.query("UPDATE ai_turns SET status='completed',lease_token=NULL,lease_until=NULL,finished_at=clock_timestamp() WHERE id=$1 AND lease_token=$2", [turn,randomUUID()]);
    assert.equal(stale.rowCount, 0);
    await db.query("UPDATE ai_turns SET status='completed',lease_token=NULL,lease_until=NULL,finished_at=clock_timestamp() WHERE id=$1", [turn]);
    await insert(randomUUID(), 2, randomUUID());
    await assert.rejects(db.query("DELETE FROM community_users WHERE github_id='991001'"), { code: '23503' });
    await db.query('DELETE FROM ai_conversations WHERE id=$1', [conversation]);
    assert.equal((await db.query('SELECT id FROM ai_messages WHERE turn_id=$1', [turn])).rows.length, 0);
  });
  await t.test('microsecond conversation cursors and large turn numbers round-trip over HTTP', async () => {
    const ids = [];
    for (let i = 0; i < 33; i++) {
      const id = randomUUID(); ids.push(id);
      await db.query(`INSERT INTO ai_conversations (id,github_id,updated_at)
        VALUES ($1,'991001',$2)`, [id,`2026-10-01 01:00:00.${String(123451 + i).padStart(6,'0')}+00`]);
    }
    const first = await (await req('chat/conversations', cookie)).json();
    assert.equal(first.items.length, 30);
    const second = await (await req('chat/conversations?cursor=' + encodeURIComponent(first.cursor), cookie)).json();
    assert.equal(second.items.length, 3);
    assert.equal(second.cursor, null);
    assert.equal(new Set([...first.items, ...second.items].map(x=>x.id)).size, 33);
    assert.equal(first.items[0].updatedAt, '2026-10-01 01:00:00.123483');
    const other = randomUUID();
    await db.query("INSERT INTO ai_conversations (id,github_id) VALUES ($1,'991002')", [other]);
    assert.equal((await req('chat/conversations', cookie, 'POST', { id: other })).status, 404);
    assert.equal((await req('chat/conversations', cookie, 'POST', { id: ids[0] })).status, 200);
    for (let i = 1; i <= 23; i++) {
      const id = randomUUID(), no = String(900000000000000n + BigInt(i));
      await db.query(`INSERT INTO ai_turns (id,conversation_id,turn_no,client_request_id,input_hash,provider,model,prompt_version,generation_options,status,finished_at)
        VALUES ($1,$2,$3,$4,$5,'test','test','v1','{}','completed',clock_timestamp())`, [id,ids[0],no,randomUUID(),Buffer.alloc(32)]);
      await db.query("INSERT INTO ai_messages (id,turn_id,role,content) VALUES ($1,$2,'user','Q'),($3,$2,'assistant','A')", [randomUUID(),id,randomUUID()]);
    }
    const path = 'chat/conversations/' + ids[0] + '/turns';
    const turns = await (await req(path, cookie)).json();
    assert.equal(turns.items.length, 20);
    assert.equal(turns.items.at(-1).turnNo, '900000000000023');
    assert.deepEqual(turns.items[0].messages.map(x=>x.role), ['user','assistant']);
    const older = await (await req(path + '?before=' + turns.before, cookie)).json();
    assert.equal(older.items.length, 3);
    assert.equal(older.before, null);
  });
  await t.test('startup and migration reject changed checksums without altering data', async () => {
    const { rows: [saved] } = await db.query("SELECT checksum FROM schema_migrations WHERE version='001-account-chat'");
    try {
      await db.query("UPDATE schema_migrations SET checksum=$1 WHERE version='001-account-chat'", ['0'.repeat(64)]);
      await assert.rejects(createApplication(config), /schemaMigrationRequired/);
      await assert.rejects(migrate(databaseUrl), /Partial or changed migration/);
      const { rows: [count] } = await db.query("SELECT count(*) n FROM ai_conversations WHERE github_id='991001'");
      assert.equal(count.n, '33');
    } finally { await db.query("UPDATE schema_migrations SET checksum=$1 WHERE version='001-account-chat'", [saved.checksum]); }
    await checkSchema(databaseUrl);
  });
});
