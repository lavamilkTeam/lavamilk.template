import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import mysql from 'mysql2/promise';
import { createApplication } from '../index.js';
import { migrate } from '../../migrations/index.js';

const databaseUrl=process.env.TEST_DATABASE_URL;
test('persistent chat: identity isolation, idempotency, recovery, retries and cancellation', {skip:!databaseUrl}, async t=>{
  await migrate(databaseUrl); // Applying an already completed migration must be harmless.
  const db=await mysql.createConnection(databaseUrl);
  const origin='https://persistent.test', modelUrl='http://127.0.0.1:18081/v1/chat/completions';
  let identity=8101, clock=Date.now(), mode='ok', calls=0, release;
  const contexts=[];
  const response=x=>new Response(JSON.stringify(x));
  const config={databaseUrl,origin,clientId:'test',clientSecret:'test',ai:{url:modelUrl,model:'gemma',provider:'llamacpp'}};
  const deps={now:()=>clock,fetch:async(url,options={})=>{
    if(url.includes('/login/oauth/access_token'))return response({access_token:'must-not-save'});
    if(url==='https://api.github.com/user')return response({id:identity,login:'chat'+identity,type:'User',name:'GitHub Name',bio:'Bio',email:'private@example.com',blog:'javascript:alert(1)'});
    assert.equal(url,modelUrl);calls++;contexts.push(JSON.parse(options.body).messages);
    if(mode==='fail')return new Response('{}',{status:503});
    if(mode==='hold')await new Promise(resolve=>{release=resolve;}); // Simulate a provider ignoring abort.
    return response({choices:[{message:{content:'Saved answer'},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:3}});
  }};
  let app,server,base;
  async function start(){app=await createApplication(config,deps);server=createServer(app.handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/api/pig-king/`;}
  async function close(){await new Promise(r=>server.close(r));await app.close();}
  await start();
  t.after(async()=>{release?.();await close();try {await db.execute('DELETE FROM ai_conversations WHERE github_id IN (?,?)',['8101','8102']);await db.execute('DELETE FROM community_sessions WHERE github_id IN (?,?)',['8101','8102']);await db.execute('DELETE FROM community_users WHERE github_id IN (?,?)',['8101','8102']);}finally{await db.end();}});
  const req=(path,cookie='',method='GET',body,requestOrigin=origin)=>fetch(base+path,{redirect:'manual',method,headers:{Cookie:cookie,Origin:requestOrigin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  async function json(path,cookie,method,body,status=200){const r=await req(path,cookie,method,body);const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;}
  async function login(id){identity=id;const s=await req('auth/login');const state=new URL(s.headers.get('location')).searchParams.get('state');const r=await req('auth/callback?code=ok&state='+state,s.headers.getSetCookie()[0].split(';')[0]);return r.headers.getSetCookie().find(x=>x.startsWith('pig_session=')).split(';')[0];}
  const a=await login(8101),b=await login(8102),id=randomUUID(),path='chat/conversations/'+id;
  assert.equal((await req('chat/conversations')).status,401);
  assert.equal((await req('chat/conversations',a,'POST',{id},'https://evil.test')).status,403);
  const p=await json('me/profile',a);assert.equal(p.profile.name,'GitHub Name');assert.equal(p.profile.website,null);assert(!JSON.stringify(p).includes('private@example'));
  await json('me/profile',a,'PATCH',{displayName:'My nickname',locale:'en'});
  await login(8101);assert.equal((await json('me/profile',a)).profile.displayName,'My nickname');
  await json('chat/conversations',a,'POST',{id});
  await json('chat/conversations',a,'POST',{id});
  for(const [method,suffix,body] of [['GET','/turns'],['PATCH','',{title:'steal',expectedRevision:'1'}],['DELETE',''],['POST','/turns',{content:'steal',clientRequestId:randomUUID()}]])assert.equal((await req(path+suffix,b,method,body)).status,404);
  assert.equal((await json('chat/conversations',b)).items.length,0);
  async function waitFor(predicate){for(let n=0;n<100;n++){const h=await json(path+'/turns',a);if(predicate(h))return h;await new Promise(r=>setTimeout(r,50));}assert.fail('Turn did not reach expected state');}
  async function age(){clock+=4000;await db.execute('UPDATE ai_turns SET created_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 5 SECOND),finished_at=IF(finished_at IS NULL,NULL,DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 5 SECOND)) WHERE conversation_id=?',[id]);}
  const input={content:'First question',clientRequestId:randomUUID()};
  const [one,two]=await Promise.all([json(path+'/turns',a,'POST',input,202),json(path+'/turns',a,'POST',input,202)]);
  assert.equal(one.turn.id,two.turn.id);
  await json(path+'/turns',a,'POST',{...input,content:'changed'},409);
  let h=await waitFor(h=>h.items[0]?.status==='completed');assert.equal(calls,1);assert.equal(h.items[0].messages[1].content,'Saved answer');
  await close();await start();h=await json(path+'/turns',a);assert.equal(h.items[0].messages.length,2,'History survives backend restart');
  await age();mode='fail';await json(path+'/turns',a,'POST',{content:'Follow up',clientRequestId:randomUUID()},202);
  h=await waitFor(h=>h.items[1]?.status==='failed');assert.equal(h.items[1].messages.length,1);
  assert.deepEqual(contexts.at(-1).slice(1).map(m=>m.role),['user','assistant','user']);
  await age();mode='ok';const turn=h.items[1];
  await json(path+'/turns/'+turn.id+'/retry',a,'POST',{expectedAttempt:1});
  await json(path+'/turns/'+turn.id+'/retry',a,'POST',{expectedAttempt:1});
  h=await waitFor(h=>h.items[1]?.status==='completed');assert.equal(h.items[1].attempt,2);assert.equal(h.items.length,2);
  await age();mode='hold';const pending=await json(path+'/turns',a,'POST',{content:'Cancel me',clientRequestId:randomUUID()},202);
  await waitFor(h=>h.items.at(-1)?.status==='running');
  const other=randomUUID();await json('chat/conversations',a,'POST',{id:other});await json('chat/conversations/'+other+'/turns',a,'POST',{content:'parallel',clientRequestId:randomUUID()},409);
  await json(path+'/turns/'+pending.turn.id+'/cancel',b,'POST',{},404);
  await json(path+'/turns/'+pending.turn.id+'/cancel',a,'POST',{});release();
  h=await waitFor(h=>h.items.at(-1)?.status==='cancelled');assert.equal(h.items.at(-1).messages.length,1);
  await new Promise(r=>setTimeout(r,100));assert.equal((await json(path+'/turns',a)).items.at(-1).messages.length,1,'Late provider reply cannot revive cancellation');
  await db.execute("UPDATE ai_turns SET status='running',finished_at=NULL,lease_token=?,lease_until=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE id=?",[randomUUID(),pending.turn.id]);
  await waitFor(h=>h.items.at(-1)?.error==='interrupted');
  h=await json(path+'/turns',a);await json(path,a,'PATCH',{state:'archived',expectedRevision:h.conversation.revision});
  await json(path,a,'PATCH',{title:'stale',expectedRevision:h.conversation.revision},409);
  assert((await json('chat/conversations?state=archived',a)).items.some(x=>x.id===id));
  h=await json(path+'/turns',a);await json(path,a,'PATCH',{state:'active',expectedRevision:h.conversation.revision});
  await age();const late=await json(path+'/turns',a,'POST',{content:'Delete during generation',clientRequestId:randomUUID()},202);
  await waitFor(h=>h.items.at(-1)?.status==='running');
  await json(path,a,'DELETE');release();await json(path+'/turns',a,undefined,undefined,404);
  await new Promise(r=>setTimeout(r,100));const [[count]]=await db.execute("SELECT COUNT(*) n FROM ai_messages WHERE turn_id=? AND role='assistant'",[late.turn.id]);assert.equal(count.n,0);
  await json('auth/logout',a,'POST',{});await json('me/profile',a,undefined,undefined,401);
});
